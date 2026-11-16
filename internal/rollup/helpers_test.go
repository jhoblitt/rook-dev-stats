package rollup_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"slices"
	"strconv"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/jhoblitt/rook-dev-stats/internal/record"
	"github.com/jhoblitt/rook-dev-stats/internal/rollup"
	"github.com/jhoblitt/rook-dev-stats/internal/tables"
)

// dataDir holds the hand-made dataset: the tables, meta.json
// and records that between them exercise every event kind, disclosure
// class and kind source.
const dataDir = "testdata/data"

// loadInput reads dataDir as rookstats rollup does.
func loadInput() rollup.Input {
	GinkgoHelper()
	t, err := tables.Load(dataDir)
	Expect(err).NotTo(HaveOccurred())
	recs, err := record.ReadRecords(dataDir)
	Expect(err).NotTo(HaveOccurred())
	meta, err := record.ReadMeta(dataDir)
	Expect(err).NotTo(HaveOccurred())
	return rollup.Input{Tables: t, Records: recs, Meta: &meta}
}

var opened = time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)

// windowStart and fetchedThrough are dataDir's meta.json, which every build
// but those without meta.json reads instead of the fetch package's window.
var (
	windowStart    = time.Date(2026, 5, 15, 0, 0, 0, 0, time.UTC)
	fetchedThrough = time.Date(2026, 11, 15, 6, 0, 0, 0, time.UTC)
)

func at(y int, mo time.Month, d, hh, mm, ss int) time.Time {
	return time.Date(y, mo, d, hh, mm, ss, 0, time.UTC)
}

// h is opened plus n hours.
func h(n int) time.Time { return opened.Add(time.Duration(n) * time.Hour) }

func epoch(t time.Time) int64 { return t.Unix() }

// pr is a minimal open pull request by alice to main, opened at opened.
func pr(number int) record.Record {
	return record.Record{
		Number:     number,
		Updated:    opened,
		Title:      "title " + strconv.Itoa(number),
		Author:     record.Actor{Login: "alice"},
		Base:       "main",
		Created:    opened,
		State:      record.StateOpen,
		Labels:     []string{},
		Events:     []record.Event{},
		Reviews:    []record.Review{},
		Comments:   []record.Comment{},
		Disclosure: record.Disclosure{Trailers: []string{}, Description: []string{}, CommitProse: []string{}},
	}
}

// output is Build's files, decoded on demand.
type output map[string][]byte

// build rolls recs up with the testdata tables and meta.
func build(recs ...record.Record) output {
	GinkgoHelper()
	in := loadInput()
	in.Records = recs
	return buildInput(in)
}

func buildInput(in rollup.Input) output {
	GinkgoHelper()
	files, err := rollup.Build(in)
	Expect(err).NotTo(HaveOccurred())
	o := output{}
	for _, f := range files {
		Expect(o).NotTo(HaveKey(f.Name), "file %s built twice", f.Name)
		o[f.Name] = f.Data
	}
	return o
}

func (o output) decode(name string, v any) {
	GinkgoHelper()
	Expect(o).To(HaveKey(name))
	Expect(json.Unmarshal(o[name], v)).To(Succeed(), "decoding %s", name)
}

type named struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type metaJSON struct {
	Repo           string   `json:"repo"`
	FetchedThrough int64    `json:"fetched_through"`
	WindowStart    int64    `json:"window_start"`
	Years          []int    `json:"years"`
	Bases          []string `json:"bases"`
	Components     []named  `json:"components"`
	Families       []named  `json:"families"`
	Commands       []named  `json:"commands"`
	Kinds          []named  `json:"kinds"`
	Disclosure     []string `json:"disclosure"`
	EventKinds     []string `json:"event_kinds"`
	People         []string `json:"people"`
	PeopleBots     []int    `json:"people_bots"`
	PeopleDeleted  []int    `json:"people_deleted"`
}

func (o output) meta() metaJSON {
	GinkgoHelper()
	var m metaJSON
	o.decode("meta.json", &m)
	return m
}

// prs is a year's PR columns, each left encoded.
func (o output) prs(year int) map[string]json.RawMessage {
	GinkgoHelper()
	var cols map[string]json.RawMessage
	o.decode(fmt.Sprintf("prs-%d.json", year), &cols)
	return cols
}

// col is a year's PR column of numbers.
func (o output) col(year int, name string) []int64 {
	GinkgoHelper()
	raw, ok := o.prs(year)[name]
	Expect(ok).To(BeTrue(), "prs-%d.json has no column %q", year, name)
	var v []int64
	Expect(json.Unmarshal(raw, &v)).To(Succeed(), "column %q", name)
	return v
}

// lists is a year's PR column of lists.
func (o output) lists(year int, name string) [][]int {
	GinkgoHelper()
	raw, ok := o.prs(year)[name]
	Expect(ok).To(BeTrue(), "prs-%d.json has no column %q", year, name)
	var v [][]int
	Expect(json.Unmarshal(raw, &v)).To(Succeed(), "column %q", name)
	return v
}

// one is a number column's value for the only PR, in the only year.
func (o output) one(name string) int64 {
	GinkgoHelper()
	years := o.meta().Years
	Expect(years).To(HaveLen(1), "years")
	v := o.col(years[0], name)
	Expect(v).To(HaveLen(1), "column %q", name)
	return v[0]
}

type eventsJSON struct {
	PR    []int   `json:"pr"`
	At    []int64 `json:"at"`
	Kind  []int   `json:"kind"`
	Sub   []int   `json:"sub"`
	Actor []int   `json:"actor"`
}

func (o output) events(year int) eventsJSON {
	GinkgoHelper()
	var e eventsJSON
	o.decode(fmt.Sprintf("events-%d.json", year), &e)
	return e
}

// commitJSON is a table's [sha, authored, committed].
type commitJSON struct {
	SHA       string
	Authored  int64
	Committed int64
}

func (c *commitJSON) UnmarshalJSON(b []byte) error {
	var a []json.RawMessage
	if err := json.Unmarshal(b, &a); err != nil {
		return err
	}
	if len(a) != 3 {
		return fmt.Errorf("a commit has %d values, not 3", len(a))
	}
	if err := json.Unmarshal(a[0], &c.SHA); err != nil {
		return err
	}
	if err := json.Unmarshal(a[1], &c.Authored); err != nil {
		return err
	}
	return json.Unmarshal(a[2], &c.Committed)
}

type tableJSON struct {
	Titles     []string       `json:"titles"`
	Authors    []string       `json:"authors"`
	Commits    [][]commitJSON `json:"commits"`
	Refs       []string       `json:"refs"`
	Issues     [][]issueJSON  `json:"issues"`
	BackportOf []int          `json:"backport_of"`
	KindSource []string       `json:"kind_source"`
}

// issueJSON is a closing issue as the table file writes it:
// [number, repository].
type issueJSON struct {
	Number     int
	Repository string
}

func (i *issueJSON) UnmarshalJSON(b []byte) error {
	var a []json.RawMessage
	if err := json.Unmarshal(b, &a); err != nil {
		return err
	}
	if len(a) != 2 {
		return fmt.Errorf("an issue is %d values, not 2", len(a))
	}
	if err := json.Unmarshal(a[0], &i.Number); err != nil {
		return err
	}
	return json.Unmarshal(a[1], &i.Repository)
}

type indexJSON struct {
	Numbers []int `json:"numbers"`
	Years   []int `json:"years"`
}

// index is index.json, decoded strictly: a field it should not have is an
// error.
func (o output) index() indexJSON {
	GinkgoHelper()
	Expect(o).To(HaveKey("index.json"))
	dec := json.NewDecoder(bytes.NewReader(o["index.json"]))
	dec.DisallowUnknownFields()
	var x indexJSON
	Expect(dec.Decode(&x)).To(Succeed(), "decoding index.json")
	Expect(x.Years).To(HaveLen(len(x.Numbers)), "index.json's years against its numbers")
	return x
}

// yearOf is the year index.json names for number, or 0 when it names none.
func (o output) yearOf(number int) int {
	GinkgoHelper()
	x := o.index()
	if i := slices.Index(x.Numbers, number); i >= 0 {
		return x.Years[i]
	}
	return 0
}

// fileYear is the year whose prs file holds number, or 0 when none does.
func (o output) fileYear(number int) int {
	GinkgoHelper()
	found := 0
	for _, y := range o.meta().Years {
		if slices.Contains(o.col(y, "number"), int64(number)) {
			Expect(found).To(BeZero(), "#%d is in prs-%d.json and prs-%d.json", number, found, y)
			found = y
		}
	}
	return found
}

// yearFiles are the years Build wrote a file of kind for, ascending.
func (o output) yearFiles(kind string) []int {
	GinkgoHelper()
	years := []int{}
	for name := range o {
		var y int
		if n, err := fmt.Sscanf(name, kind+"-%d.json", &y); err == nil && n == 1 {
			years = append(years, y)
		}
	}
	slices.Sort(years)
	return years
}

func (o output) table(year int) tableJSON {
	GinkgoHelper()
	var t tableJSON
	o.decode(fmt.Sprintf("table-%d.json", year), &t)
	return t
}

// tableRaw is a year's table columns, each left encoded.
func (o output) tableRaw(year int) map[string]json.RawMessage {
	GinkgoHelper()
	var cols map[string]json.RawMessage
	o.decode(fmt.Sprintf("table-%d.json", year), &cols)
	return cols
}

// ev is one event of a year's events file, its indexes resolved through
// meta and its ref taken from the year's table.
type ev struct {
	PR    int
	At    time.Time
	Kind  string
	Sub   string
	Actor string
	Ref   string
}

func (o output) evs(year int) []ev {
	GinkgoHelper()
	m, e, t := o.meta(), o.events(year), o.table(year)
	numbers := o.col(year, "number")
	Expect(t.Refs).To(HaveLen(len(e.PR)))
	out := make([]ev, len(e.PR))
	for i := range e.PR {
		out[i] = ev{
			PR:   int(numbers[e.PR[i]]),
			At:   time.Unix(e.At[i], 0).UTC(),
			Kind: m.EventKinds[e.Kind[i]],
			Ref:  t.Refs[i],
		}
		if s := e.Sub[i]; s != -1 {
			out[i].Sub = m.Commands[s].ID
		}
		if a := e.Actor[i]; a != -1 {
			out[i].Actor = m.People[a]
		}
	}
	return out
}

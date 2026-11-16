// Package rollup turns the committed records, classified with the
// hand-edited tables, into the statistics site's data files: meta.json;
// for each year, prs-<year>.json, events-<year>.json and table-<year>.json,
// holding the pull requests that finished in that year, and those still
// open under the year of fetched_through, each with all of its events and
// its table row; and index.json, the year each pull request is filed under,
// by number. Times are epoch seconds and -1 means none or unknown; every
// other number is a count, a flag, or an index into one of meta.json's
// dictionaries.
package rollup

import (
	"bytes"
	"cmp"
	"encoding/json"
	"fmt"
	"maps"
	"slices"
	"time"

	"github.com/jhoblitt/rook-dev-stats/internal/classify"
	"github.com/jhoblitt/rook-dev-stats/internal/fetch"
	"github.com/jhoblitt/rook-dev-stats/internal/record"
	"github.com/jhoblitt/rook-dev-stats/internal/tables"
)

// The event kinds of a review. A comment's kinds are classify's, and a
// lifecycle event's are record's. The first three are the human reviews; a
// review by the pull request's own author, almost always a reply in a
// review thread, is not one of them.
const (
	reviewApproved  = "review_approved"
	reviewChanges   = "review_changes"
	reviewCommented = "review_commented"
	botReview       = "bot_review"
	reviewAuthor    = "review_author"
)

// lifecycleKinds are the event kinds a record holds. The site knows more,
// but a comment's or a review's kind in a record's events would be written
// without the actor those kinds carry.
var lifecycleKinds = []string{
	record.KindReady, record.KindDraft, record.KindForcePush, record.KindClosed, record.KindReopened, record.KindMerged,
}

// eventKinds is meta.json's event_kinds, in the site's order.
var eventKinds = slices.Concat([]string{
	classify.CommentOther, classify.CommentAuthor, classify.CommandAuthor, classify.CommandOther, classify.BotAccount,
	reviewApproved, reviewChanges, reviewCommented, botReview, reviewAuthor,
}, lifecycleKinds)

var states = map[string]int{record.StateOpen: 0, record.StateMerged: 1, record.StateClosed: 2}

// Input is what the site's data is rolled up from.
type Input struct {
	Tables *tables.Tables
	// Records are every record, in any order.
	Records []record.Record
	// Meta is data/meta.json, or nil when there is none.
	Meta *record.Meta
}

// File is one file of the site's data.
type File struct {
	Name string
	Data []byte
}

type named struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type metaFile struct {
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
	// People are the logins an author or actor index names, in order of
	// first appearance over the records by number. The author of a pull
	// request opened by a deleted account that its commits name is
	// deletedPrefix and that name instead, which no login can collide with
	// since a login has no colon; every other deleted account is the one
	// login ghost.
	People []string `json:"people"`
	// PeopleBots are the indexes into People of the accounts that are not
	// human, ascending.
	PeopleBots []int `json:"people_bots"`
	// PeopleDeleted are the indexes into People of the deleted accounts'
	// names, ascending.
	PeopleDeleted []int `json:"people_deleted"`
}

// deletedPrefix begins a deleted account's name in meta.json's people.
const deletedPrefix = fetch.GhostLogin + ":"

// indexFile is index.json: Years[i] is the year whose files hold the pull
// request numbered Numbers[i], and Numbers ascends. The site reads it only
// to find a pull request outside the years it has loaded.
type indexFile struct {
	Numbers []int `json:"numbers"`
	Years   []int `json:"years"`
}

// Build returns the site's data files for in: meta.json first, then
// index.json, then each year's files, years ascending. The same input always gives the same
// bytes, whatever the order of its records.
func Build(in Input) ([]File, error) {
	recs := slices.Clone(in.Records)
	slices.SortFunc(recs, func(a, b record.Record) int { return cmp.Compare(a.Number, b.Number) })
	prs := classify.Records(in.Tables, recs)

	b := newBuilder(in, recs)
	for i := range recs {
		if err := b.add(&recs[i], &prs[i]); err != nil {
			return nil, err
		}
	}
	return b.files()
}

type builder struct {
	meta        metaFile
	index       indexFile
	windowStart time.Time
	fetchedYear int
	bases       map[string]int
	components  map[string]int
	families    map[string]int
	commands    map[string]int
	kinds       map[string]int
	eventKinds  map[string]int
	people      map[string]int
	bots        map[int]bool
	deleted     map[int]bool
	years       map[int]*year
}

func newBuilder(in Input, recs []record.Record) *builder {
	m := metaFile{
		Repo:          fetch.Owner + "/" + fetch.Name,
		Years:         []int{},
		Disclosure:    classify.DisclosureClasses(),
		EventKinds:    eventKinds,
		People:        []string{},
		PeopleBots:    []int{},
		PeopleDeleted: []int{},
	}
	windowStart := fetch.WindowStart
	switch {
	case in.Meta != nil:
		if in.Meta.Repo != "" {
			m.Repo = in.Meta.Repo
		}
		if !in.Meta.WindowStart.IsZero() {
			windowStart = in.Meta.WindowStart
		}
		m.FetchedThrough = epoch(in.Meta.FetchedThrough)
	default:
		// Without meta.json the data is as fresh as its latest record.
		latest := windowStart
		for i := range recs {
			if recs[i].Updated.After(latest) {
				latest = recs[i].Updated
			}
		}
		m.FetchedThrough = epoch(latest)
	}
	m.WindowStart = epoch(windowStart)

	bases := map[string]bool{}
	for i := range recs {
		bases[recs[i].Base] = true
	}
	m.Bases = slices.Sorted(maps.Keys(bases))
	if m.Bases == nil {
		m.Bases = []string{}
	}
	t := in.Tables
	m.Components = make([]named, 0, len(t.Labels.Components))
	for _, c := range t.Labels.Components {
		m.Components = append(m.Components, named{c.ID, c.Name})
	}
	m.Families = make([]named, 0, len(t.Tools.Families))
	for _, f := range t.Tools.Families {
		m.Families = append(m.Families, named{f.ID, f.Name})
	}
	m.Commands = make([]named, 0, len(t.Commands.List))
	for _, c := range t.Commands.List {
		m.Commands = append(m.Commands, named{c.ID, c.Name})
	}
	m.Kinds = make([]named, 0, len(t.Kinds.List))
	for _, k := range t.Kinds.List {
		m.Kinds = append(m.Kinds, named{k.ID, k.Name})
	}

	return &builder{
		meta:        m,
		index:       indexFile{Numbers: []int{}, Years: []int{}},
		windowStart: windowStart,
		fetchedYear: time.Unix(m.FetchedThrough, 0).UTC().Year(),
		bases:       indexOf(m.Bases, func(s string) string { return s }),
		components:  indexOf(m.Components, namedID),
		families:    indexOf(m.Families, namedID),
		commands:    indexOf(m.Commands, namedID),
		kinds:       indexOf(m.Kinds, namedID),
		eventKinds:  indexOf(m.EventKinds, func(s string) string { return s }),
		people:      map[string]int{},
		bots:        map[int]bool{},
		deleted:     map[int]bool{},
		years:       map[int]*year{},
	}
}

func namedID(n named) string { return n.ID }

func indexOf[T any](list []T, key func(T) string) map[string]int {
	m := make(map[string]int, len(list))
	for i, v := range list {
		m[key(v)] = i
	}
	return m
}

// person is login's index into meta.json's people, assigned on first
// appearance; bot marks the account as one that is not human.
func (b *builder) person(login string, bot bool) int {
	i, ok := b.people[login]
	if !ok {
		i = len(b.meta.People)
		b.people[login] = i
		b.meta.People = append(b.meta.People, login)
	}
	if bot {
		b.bots[i] = true
	}
	return i
}

// author is the index into meta.json's people of r's author: its
// deletedPrefix entry for a deleted account its commits name, which is never
// a bot's, and otherwise its login's.
func (b *builder) author(r *record.Record, human bool) int {
	if r.Author.Login != fetch.GhostLogin || r.Author.Name == "" {
		return b.person(r.Author.Login, !human)
	}
	i := b.person(deletedPrefix+r.Author.Name, false)
	b.deleted[i] = true
	return i
}

func (b *builder) files() ([]File, error) {
	b.meta.Years = slices.Sorted(maps.Keys(b.years))
	if b.meta.Years == nil {
		b.meta.Years = []int{}
	}
	b.meta.PeopleBots = slices.Sorted(maps.Keys(b.bots))
	if b.meta.PeopleBots == nil {
		b.meta.PeopleBots = []int{}
	}
	b.meta.PeopleDeleted = slices.Sorted(maps.Keys(b.deleted))
	if b.meta.PeopleDeleted == nil {
		b.meta.PeopleDeleted = []int{}
	}
	files := make([]File, 0, 2+3*len(b.years))
	add := func(name string, v any) error {
		data, err := encode(v)
		if err != nil {
			return fmt.Errorf("encoding %s: %w", name, err)
		}
		files = append(files, File{Name: name, Data: data})
		return nil
	}
	if err := add("meta.json", b.meta); err != nil {
		return nil, err
	}
	if err := add("index.json", b.index); err != nil {
		return nil, err
	}
	for _, y := range b.meta.Years {
		yr := b.years[y]
		for _, f := range []struct {
			kind string
			v    any
		}{{"prs", &yr.prs}, {"events", &yr.events}, {"table", &yr.table}} {
			if err := add(fmt.Sprintf("%s-%d.json", f.kind, y), f.v); err != nil {
				return nil, err
			}
		}
	}
	return files, nil
}

// encode is compact JSON. Titles are text, not HTML, so they are not
// escaped as HTML.
func encode(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(buf.Bytes(), []byte("\n")), nil
}

// epoch is t in seconds since 1970, or -1 for a time before then, the zero
// time among them.
func epoch(t time.Time) int64 {
	if s := t.Unix(); s >= 0 {
		return s
	}
	return -1
}

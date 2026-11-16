package rollup_test

import (
	"os"
	"path/filepath"
	"slices"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/jhoblitt/rook-dev-stats/internal/record"
	"github.com/jhoblitt/rook-dev-stats/internal/rollup"
)

var _ = Describe("the year a pull request is filed under", func() {
	// fetchedYear is the UTC year of dataDir's fetched_through.
	const fetchedYear = 2026

	It("is fetched_through's year for a pull request still open, however old", func() {
		r := pr(1)
		r.Created = at(2019, time.March, 4, 0, 0, 0)
		r.Updated = at(2019, time.March, 5, 0, 0, 0)
		o := build(r)
		Expect(o.meta().Years).To(Equal([]int{fetchedYear}))
		Expect(o.fileYear(1)).To(Equal(fetchedYear))
		Expect(o.yearOf(1)).To(Equal(fetchedYear))
		Expect(o.col(fetchedYear, "created")).To(Equal([]int64{epoch(r.Created)}))
	})

	It("is fetched_through's year for a pull request closed, reopened and open now", func() {
		r := pr(1)
		r.Created = at(2024, time.February, 1, 0, 0, 0)
		r.Events = []record.Event{
			event(at(2024, time.March, 1, 0, 0, 0), record.KindClosed),
			event(at(2025, time.April, 1, 0, 0, 0), record.KindReopened),
		}
		o := build(r)
		Expect(o.meta().Years).To(Equal([]int{fetchedYear}))
		Expect(o.yearOf(1)).To(Equal(fetchedYear))
		Expect(o.evs(fetchedYear)).To(Equal([]ev{
			{PR: 1, At: at(2024, time.March, 1, 0, 0, 0), Kind: "closed"},
			{PR: 1, At: at(2025, time.April, 1, 0, 0, 0), Kind: "reopened"},
		}))
	})

	DescribeTable("is the UTC year of the final disposition of a finished pull request",
		func(state string, updated time.Time, events []record.Event, want int) {
			r := pr(1)
			r.Created = at(2025, time.December, 20, 0, 0, 0)
			r.State = state
			r.Updated = updated
			r.Events = events
			o := build(r)
			Expect(o.meta().Years).To(Equal([]int{want}))
			Expect(o.yearOf(1)).To(Equal(want))
			Expect(time.Unix(o.one("closed"), 0).UTC().Year()).To(Equal(want), "the closed column's year")
		},
		Entry("closed at the last second of 31 December: that year", record.StateClosed, at(2026, time.March, 1, 0, 0, 0),
			[]record.Event{event(at(2025, time.December, 31, 23, 59, 59), record.KindClosed)}, 2025),
		Entry("closed a second later: the next year", record.StateClosed, at(2026, time.March, 1, 0, 0, 0),
			[]record.Event{event(at(2026, time.January, 1, 0, 0, 0), record.KindClosed)}, 2026),
		Entry("merged at the last second of 31 December, the close it caused a second later: the close's, as the closed column",
			record.StateMerged, at(2026, time.March, 1, 0, 0, 0), []record.Event{
				event(at(2025, time.December, 31, 23, 59, 59), record.KindMerged),
				event(at(2026, time.January, 1, 0, 0, 0), record.KindClosed),
			}, 2026),
		Entry("closed, reopened and closed again the next year: the last close", record.StateClosed, at(2026, time.March, 1, 0, 0, 0),
			[]record.Event{
				event(at(2025, time.December, 21, 0, 0, 0), record.KindClosed),
				event(at(2025, time.December, 22, 0, 0, 0), record.KindReopened),
				event(at(2026, time.January, 5, 0, 0, 0), record.KindClosed),
			}, 2026),
		Entry("merged with no merge event: its last close, written as the merge", record.StateMerged, at(2026, time.March, 1, 0, 0, 0),
			[]record.Event{event(at(2025, time.December, 30, 0, 0, 0), record.KindClosed)}, 2025),
		Entry("merged with no event at all: its last update", record.StateMerged, at(2026, time.March, 1, 0, 0, 0),
			[]record.Event{}, 2026),
		Entry("closed on 31 December in a zone where it was already 1 January in UTC: UTC's year", record.StateClosed,
			at(2026, time.March, 1, 0, 0, 0),
			[]record.Event{event(time.Date(2025, time.December, 31, 20, 0, 0, 0, time.FixedZone("PST", -8*3600)), record.KindClosed)}, 2026),
	)

	It("carries every event and table row of a pull request with it, whenever they happened", func() {
		r := pr(1)
		r.Created = at(2024, time.November, 1, 0, 0, 0)
		r.State = record.StateMerged
		r.Title = "spans three years"
		r.Comments = []record.Comment{{At: at(2024, time.November, 2, 0, 0, 0), ID: 11, By: "bob"}}
		r.Reviews = []record.Review{{At: at(2025, time.June, 1, 0, 0, 0), ID: 12, By: "carol", State: record.ReviewApproved}}
		r.Events = []record.Event{{At: at(2026, time.January, 2, 0, 0, 0), Kind: record.KindMerged, ID: 13}}
		r.Commits = record.Commits{Count: 1, List: []record.Commit{{
			SHA: "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d", Authored: r.Created, Committed: r.Created,
		}}}
		o := build(r)
		Expect(o.meta().Years).To(Equal([]int{2026}))
		Expect(o.yearFiles("events")).To(Equal([]int{2026}))
		Expect(o.yearFiles("table")).To(Equal([]int{2026}))
		Expect(o.evs(2026)).To(Equal([]ev{
			{PR: 1, At: at(2024, time.November, 2, 0, 0, 0), Kind: "comment_other", Actor: "bob", Ref: "11"},
			{PR: 1, At: at(2025, time.June, 1, 0, 0, 0), Kind: "review_approved", Actor: "carol", Ref: "12"},
			{PR: 1, At: at(2026, time.January, 2, 0, 0, 0), Kind: "merged"},
		}))
		t := o.table(2026)
		Expect(t.Titles).To(Equal([]string{"spans three years"}))
		Expect(t.Commits).To(HaveLen(1))
	})

	It("puts each pull request's events on its own row of its year, wherever the pull requests numbered beside it went", func() {
		a, b, c := pr(10), pr(11), pr(12)
		a.Created = at(2025, time.March, 1, 0, 0, 0)
		a.Comments = []record.Comment{{At: at(2025, time.March, 2, 0, 0, 0), ID: 101, By: "bob"}}
		b.Created = at(2025, time.March, 1, 1, 0, 0)
		b.State = record.StateClosed
		b.Events = []record.Event{{At: at(2025, time.March, 3, 0, 0, 0), Kind: record.KindClosed, ID: 111}}
		c.Created = at(2025, time.March, 1, 2, 0, 0)
		c.Comments = []record.Comment{{At: at(2025, time.March, 4, 0, 0, 0), ID: 121, By: "carol"}}
		o := build(c, a, b)
		Expect(o.meta().Years).To(Equal([]int{2025, fetchedYear}))
		Expect(o.evs(2025)).To(Equal([]ev{{PR: 11, At: at(2025, time.March, 3, 0, 0, 0), Kind: "closed", Ref: "111"}}))
		Expect(o.evs(fetchedYear)).To(Equal([]ev{
			{PR: 10, At: at(2025, time.March, 2, 0, 0, 0), Kind: "comment_other", Actor: "bob", Ref: "101"},
			{PR: 12, At: at(2025, time.March, 4, 0, 0, 0), Kind: "comment_other", Actor: "carol", Ref: "121"},
		}))
		Expect(o.events(fetchedYear).PR).To(Equal([]int{0, 1}))
		Expect(o.col(fetchedYear, "number")).To(Equal([]int64{10, 12}))
	})

	Describe("over pull requests finishing in several years", func() {
		var o output

		BeforeEach(func() {
			var recs []record.Record
			finish := []struct {
				state string
				at    time.Time
			}{
				{record.StateMerged, at(2023, time.July, 1, 0, 0, 0)},
				{record.StateOpen, time.Time{}},
				{record.StateClosed, at(2025, time.January, 1, 0, 0, 0)},
				{record.StateMerged, at(2023, time.December, 31, 23, 59, 59)},
				{record.StateClosed, at(2024, time.February, 1, 0, 0, 0)},
				{record.StateOpen, time.Time{}},
				{record.StateMerged, at(2026, time.October, 1, 0, 0, 0)},
			}
			for i, f := range finish {
				r := pr(100 + 7*i)
				r.Created = at(2023, time.June, 1+i, 0, 0, 0)
				r.Updated = r.Created
				r.State = f.state
				switch f.state {
				case record.StateMerged:
					r.Events = []record.Event{event(f.at, record.KindMerged)}
				case record.StateClosed:
					r.Events = []record.Event{event(f.at, record.KindClosed)}
				}
				recs = append(recs, r)
			}
			slices.Reverse(recs)
			o = build(recs...)
		})

		It("lists exactly the years with files, ascending", func() {
			m := o.meta()
			Expect(m.Years).To(Equal([]int{2023, 2024, 2025, 2026}))
			Expect(o.yearFiles("prs")).To(Equal(m.Years))
			Expect(o.yearFiles("events")).To(Equal(m.Years))
			Expect(o.yearFiles("table")).To(Equal(m.Years))
		})

		It("indexes every pull request by number, ascending, under the year whose files hold it", func() {
			x := o.index()
			Expect(x.Numbers).To(Equal([]int{100, 107, 114, 121, 128, 135, 142}))
			Expect(x.Years).To(Equal([]int{2023, 2026, 2025, 2023, 2024, 2026, 2026}))
			for i, n := range x.Numbers {
				Expect(o.fileYear(n)).To(Equal(x.Years[i]), "#%d", n)
			}
		})
	})

	It("removes the files of a year that no longer holds a pull request", func() {
		dir := filepath.Join(GinkgoT().TempDir(), "data")
		r := pr(1)
		r.Created = at(2025, time.March, 1, 0, 0, 0)
		r.State = record.StateClosed
		r.Events = []record.Event{event(at(2025, time.March, 2, 0, 0, 0), record.KindClosed)}
		files := func(r record.Record) []rollup.File {
			GinkgoHelper()
			in := loadInput()
			in.Records = []record.Record{r}
			fs, err := rollup.Build(in)
			Expect(err).NotTo(HaveOccurred())
			return fs
		}
		_, err := rollup.Write(dir, files(r))
		Expect(err).NotTo(HaveOccurred())

		r.State = record.StateOpen
		r.Events = append(r.Events, event(at(2026, time.July, 1, 0, 0, 0), record.KindReopened))
		res, err := rollup.Write(dir, files(r))
		Expect(err).NotTo(HaveOccurred())
		Expect(res.Removed).To(Equal([]string{"events-2025.json", "prs-2025.json", "table-2025.json"}))
		entries, err := os.ReadDir(dir)
		Expect(err).NotTo(HaveOccurred())
		var left []string
		for _, e := range entries {
			left = append(left, e.Name())
		}
		Expect(left).To(ConsistOf("meta.json", "index.json", "prs-2026.json", "events-2026.json", "table-2026.json"))
	})
})

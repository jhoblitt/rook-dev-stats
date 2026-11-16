package rollup_test

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/jhoblitt/rook-dev-stats/internal/rollup"
)

// goldenDir holds Build's output for dataDir, byte for byte. The site's
// rollup-contract spec loads these files through the site's own loader, so
// they are the seam between the two halves. After a deliberate change to
// the output, rewrite them with
//
//	ROOKSTATS_UPDATE_GOLDEN=1 go test ./internal/rollup/
//
// and review the diff.
const goldenDir = "testdata/golden"

var _ = Describe("the hand-made dataset", func() {
	var (
		in    rollup.Input
		files []rollup.File
		o     output
	)

	BeforeEach(func() {
		in = loadInput()
		var err error
		files, err = rollup.Build(in)
		Expect(err).NotTo(HaveOccurred())
		o = buildInput(in)
	})

	It("matches the golden files byte for byte", func() {
		if os.Getenv("ROOKSTATS_UPDATE_GOLDEN") != "" {
			_, err := rollup.Write(goldenDir, files)
			Expect(err).NotTo(HaveOccurred())
		}
		entries, err := os.ReadDir(goldenDir)
		Expect(err).NotTo(HaveOccurred())
		var have, built []string
		for _, e := range entries {
			have = append(have, e.Name())
		}
		for _, f := range files {
			built = append(built, f.Name)
		}
		Expect(have).To(ConsistOf(built))
		for _, f := range files {
			want, err := os.ReadFile(filepath.Join(goldenDir, f.Name))
			Expect(err).NotTo(HaveOccurred())
			Expect(string(f.Data)).To(Equal(string(want)), "%s differs from its golden file", f.Name)
		}
	})

	It("exercises what it is meant to", func() {
		m := o.meta()
		Expect(m.Years).To(Equal([]int{2025, 2026}))
		kinds, sources, classes := map[string]bool{}, map[string]bool{}, map[string]bool{}
		for _, y := range m.Years {
			for _, k := range o.events(y).Kind {
				kinds[m.EventKinds[k]] = true
			}
			for _, s := range o.table(y).KindSource {
				sources[s] = true
			}
			for _, d := range o.col(y, "disclosure") {
				classes[m.Disclosure[d]] = true
			}
		}
		Expect(kinds).To(HaveLen(len(m.EventKinds)), "every event kind")
		Expect(classes).To(HaveLen(len(m.Disclosure)), "every disclosure class")
		Expect(sources).To(HaveLen(5), "every kind source and none")
		Expect(m.PeopleBots).NotTo(BeEmpty())
		Expect(m.PeopleDeleted).NotTo(BeEmpty(), "a deleted account named by its commits")
		Expect(m.People).To(ContainElement("ghost"), "the pooled deleted accounts beside it")
		Expect(o.col(2025, "in_window")).To(ContainElement(int64(0)))
		Expect(o.col(2026, "backport_link")).To(ContainElements(int64(0), int64(1)), "a backport that links its original and PRs that do not")
	})

	It("files a pull request under the year it finished in, not the year it opened in", func() {
		Expect(o.fileYear(64100)).To(Equal(2026), "#64100, opened in 2025 and merged in 2026")
		Expect(o.fileYear(64150)).To(Equal(2025), "#64150, closed at the last second of 2025")
	})

	It("indexes every pull request, ascending, under the year whose files hold it", func() {
		x := o.index()
		Expect(slices.IsSorted(x.Numbers)).To(BeTrue(), "numbers ascending")
		var all []int
		for _, y := range o.meta().Years {
			for _, n := range o.col(y, "number") {
				all = append(all, int(n))
			}
		}
		Expect(x.Numbers).To(ConsistOf(all))
		for i, n := range x.Numbers {
			Expect(o.fileYear(n)).To(Equal(x.Years[i]), "#%d", n)
		}
	})

	It("writes every column of a year file with one length", func() {
		for _, y := range o.meta().Years {
			rows := len(o.col(y, "number"))
			Expect(rows).To(BeNumerically(">", 0))
			for name, raw := range o.prs(y) {
				var v []json.RawMessage
				Expect(json.Unmarshal(raw, &v)).To(Succeed())
				Expect(v).To(HaveLen(rows), "prs-%d.json column %q", y, name)
			}
			e := o.events(y)
			for name, c := range map[string]int{"at": len(e.At), "kind": len(e.Kind), "sub": len(e.Sub), "actor": len(e.Actor)} {
				Expect(c).To(Equal(len(e.PR)), "events-%d.json column %q", y, name)
			}
			t := o.table(y)
			for name, c := range map[string]int{
				"titles": len(t.Titles), "authors": len(t.Authors), "commits": len(t.Commits),
				"tickets": len(t.Tickets), "backport_of": len(t.BackportOf), "kind_source": len(t.KindSource),
			} {
				Expect(c).To(Equal(rows), "table-%d.json column %q", y, name)
			}
			Expect(t.Refs).To(HaveLen(len(e.PR)), "table-%d.json refs", y)
		}
	})

	It("keeps every index inside its dictionary", func() {
		m := o.meta()
		inside := func(n int64, size int, what string, y int) {
			GinkgoHelper()
			Expect(n).To(And(BeNumerically(">=", 0), BeNumerically("<", size)), "%s in %d", what, y)
		}
		for _, y := range m.Years {
			for _, v := range o.col(y, "base") {
				inside(v, len(m.Bases), "base", y)
			}
			for _, v := range o.col(y, "disclosure") {
				inside(v, len(m.Disclosure), "disclosure", y)
			}
			for _, v := range o.col(y, "state") {
				inside(v, 3, "state", y)
			}
			for _, v := range o.col(y, "author") {
				inside(v, len(m.People), "author", y)
			}
			for i, v := range o.col(y, "kind") {
				Expect(v).To(BeNumerically(">=", -1), "kind in %d", y)
				Expect(v).To(BeNumerically("<", len(m.Kinds)), "kind in %d", y)
				if v == -1 {
					Expect(o.table(y).KindSource[i]).To(BeEmpty(), "kind_source of row %d in %d", i, y)
				} else {
					Expect(o.table(y).KindSource[i]).NotTo(BeEmpty(), "kind_source of row %d in %d", i, y)
				}
			}
			for _, l := range o.lists(y, "families") {
				Expect(slices.IsSorted(l)).To(BeTrue(), "families %v in %d", l, y)
				for _, v := range l {
					inside(int64(v), len(m.Families), "family", y)
				}
			}
			for _, l := range o.lists(y, "components") {
				Expect(slices.IsSorted(l)).To(BeTrue(), "components %v in %d", l, y)
				for _, v := range l {
					inside(int64(v), len(m.Components), "component", y)
				}
			}
			e := o.events(y)
			for i := range e.PR {
				inside(int64(e.Kind[i]), len(m.EventKinds), "event kind", y)
				switch kind := m.EventKinds[e.Kind[i]]; kind {
				case "command_author", "command_other":
					inside(int64(e.Sub[i]), len(m.Commands), "command", y)
				default:
					Expect(e.Sub[i]).To(Equal(-1), "sub of a %s in %d", kind, y)
				}
				switch kind := m.EventKinds[e.Kind[i]]; kind {
				case "comment_other", "review_approved", "review_changes", "review_commented":
					inside(int64(e.Actor[i]), len(m.People), "actor", y)
				default:
					Expect(e.Actor[i]).To(Equal(-1), "actor of a %s in %d", kind, y)
				}
			}
		}
	})

	It("gives every merged or closed pull request a close time", func() {
		for _, y := range o.meta().Years {
			state, closed := o.col(y, "state"), o.col(y, "closed")
			for i := range state {
				if state[i] == 0 {
					Expect(closed[i]).To(Equal(int64(-1)), "row %d of %d is open", i, y)
				} else {
					Expect(closed[i]).To(BeNumerically(">=", 0), "row %d of %d is finished", i, y)
				}
			}
		}
	})

	It("sorts events by row, then time, each on a row of its year", func() {
		for _, y := range o.meta().Years {
			rows := len(o.col(y, "number"))
			e := o.events(y)
			for i := range e.PR {
				Expect(e.PR[i]).To(And(BeNumerically(">=", 0), BeNumerically("<", rows)), "event %d of %d", i, y)
				if i > 0 {
					Expect([]int64{int64(e.PR[i-1]), e.At[i-1]}).To(
						Satisfy(func(prev []int64) bool {
							return prev[0] < int64(e.PR[i]) || prev[0] == int64(e.PR[i]) && prev[1] <= e.At[i]
						}), "event %d of %d is out of order", i, y)
				}
			}
			Expect(slices.IsSorted(o.col(y, "number"))).To(BeTrue(), "rows of %d by number", y)
		}
	})

	It("names each person once, bots among them", func() {
		m := o.meta()
		Expect(slices.Compact(slices.Sorted(slices.Values(m.People)))).To(HaveLen(len(m.People)))
		Expect(slices.IsSorted(m.PeopleBots)).To(BeTrue())
		Expect(slices.Compact(slices.Clone(m.PeopleBots))).To(HaveLen(len(m.PeopleBots)))
		for _, b := range m.PeopleBots {
			Expect(b).To(And(BeNumerically(">=", 0), BeNumerically("<", len(m.People))))
		}
		var deleted []int
		for i, p := range m.People {
			if strings.HasPrefix(p, "ghost:") {
				deleted = append(deleted, i)
			}
		}
		Expect(m.PeopleDeleted).To(Equal(deleted), "people_deleted is exactly the ghost: entries, ascending")
		for _, d := range m.PeopleDeleted {
			Expect(m.PeopleBots).NotTo(ContainElement(d))
		}
		named := map[int]bool{}
		for _, y := range m.Years {
			for _, a := range o.col(y, "author") {
				named[int(a)] = true
			}
			for _, a := range o.events(y).Actor {
				if a != -1 {
					named[a] = true
				}
			}
		}
		Expect(named).To(HaveLen(len(m.People)), "every person is someone's author or actor")
	})

	It("writes compact JSON with no insignificant whitespace", func() {
		for _, f := range files {
			var c bytes.Buffer
			Expect(json.Compact(&c, f.Data)).To(Succeed(), f.Name)
			Expect(c.String()).To(Equal(string(f.Data)), f.Name)
		}
	})

	It("writes the same bytes on every run, whatever the records' order", func() {
		again, err := rollup.Build(in)
		Expect(err).NotTo(HaveOccurred())
		Expect(again).To(Equal(files))
		slices.Reverse(in.Records)
		reversed, err := rollup.Build(in)
		Expect(err).NotTo(HaveOccurred())
		Expect(reversed).To(Equal(files))
	})
})

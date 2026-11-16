package extract_test

import (
	"encoding/json"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/jhoblitt/ceph-dev-stats/internal/extract"
	"github.com/jhoblitt/ceph-dev-stats/internal/fetch"
	"github.com/jhoblitt/ceph-dev-stats/internal/record"
)

// template is the Tracker section of ceph/ceph's pull request template,
// every box unticked.
const template = "## Checklist\r\n" +
	"- Tracker (select at least one)\r\n" +
	"  - [ ] References tracker ticket\r\n" +
	"  - [ ] Very recent bug; references commit where it was introduced\r\n" +
	"  - [ ] New feature (ticket optional)\r\n" +
	"  - [ ] Doc update (no ticket needed)\r\n" +
	"  - [ ] Code cleanup (no ticket needed)\r\n" +
	"- Tests (select at least one)\r\n" +
	"  - [x] No tests\r\n"

var _ = Describe("Hints", func() {
	DescribeTable("finds the hints",
		func(messages []string, description string, want *record.KindHints) {
			Expect(extract.Hints(messages, description)).To(Equal(want))
		},
		Entry("a box ticked with [x]", nil,
			"- [x] Code cleanup (no ticket needed)",
			&record.KindHints{Checklist: []string{record.CheckCodeCleanup}}),
		Entry("a box ticked with [X], indented as in the template", nil,
			"  - [X] New feature (ticket optional)",
			&record.KindHints{Checklist: []string{record.CheckNewFeature}}),
		Entry("every box ticked, listed in the template's order whatever the description's", nil,
			"- [x] Code cleanup (no ticket needed)\n"+
				"- [x] Doc update (no ticket needed)\n"+
				"- [x] New feature (ticket optional)\n"+
				"- [x] Very recent bug; references commit where it was introduced\n"+
				"- [x] References tracker ticket: https://tracker.example.com/issues/1\n",
			&record.KindHints{Checklist: []string{
				record.CheckReferencesTicket, record.CheckVeryRecentBug, record.CheckNewFeature,
				record.CheckDocUpdate, record.CheckCodeCleanup,
			}}),
		Entry("the template with nothing ticked in the Tracker section", nil,
			template, nil),
		Entry("a ticket in a commit's Fixes: trailer", []string{
			"osd: fix it\n\nFixes: https://tracker.ceph.com/issues/90001\nSigned-off-by: A <a@example.com>\n",
		}, "", &record.KindHints{Tickets: []int{90001}}),
		Entry("Fixes: trailers in commit order, then the description's tickets, each once", []string{
			"one\n\nFixes: https://tracker.ceph.com/issues/90003\n",
			"two\n\nfixes:http://tracker.ceph.com/issues/90001, https://tracker.ceph.com/issues/90003\n",
		}, "See tracker.ceph.com/issues/90002 and (https://tracker.ceph.com/issues/90001#note-4).",
			&record.KindHints{Tickets: []int{90003, 90001, 90002}}),
		Entry("a ticket in a commit outside a Fixes: trailer", []string{
			"osd: fix it\n\nSee https://tracker.ceph.com/issues/90001\nRefs: https://tracker.ceph.com/issues/90002\n",
		}, "", nil),
		Entry("a ticket URL of another host", nil,
			"https://tracker.example.com/issues/90001 https://mytracker.ceph.com/issues/90002 https://tracker.ceph.com.example.org/issues/90003",
			nil),
		Entry("a ticket URL without a number", nil,
			"https://tracker.ceph.com/issues/<id> https://tracker.ceph.com/issues/12ab", nil),
		Entry("backport of a pull-request URL", nil,
			"backport of https://github.com/ceph/ceph/pull/69001\r\n",
			&record.KindHints{BackportOf: 69001}),
		Entry("Backport of #<digits>, followed by a colon", nil,
			"Backport of: #69001 (clean cherry-pick).",
			&record.KindHints{BackportOf: 69001}),
		Entry("BACKPORT OF a Markdown link to the pull request", nil,
			"This is a BACKPORT OF [#69001](https://github.com/ceph/ceph/pull/69001) to squid.",
			&record.KindHints{BackportOf: 69001}),
		Entry("backport of the first pull request named, the later ones ignored", nil,
			"backport of https://github.com/ceph/ceph/pull/69001, https://github.com/ceph/ceph/pull/69002",
			&record.KindHints{BackportOf: 69001}),
		Entry("backport of with no number", nil,
			"This is a backport of the fix for the listing race.", nil),
		Entry("backport of a pull request in another repository", nil,
			"backport of https://github.com/ceph/ceph-ci/pull/69001", nil),
		Entry("backport of in a commit message rather than the description", []string{
			"rgw: fix it\n\nbackport of https://github.com/ceph/ceph/pull/69001\n",
		}, "", nil),
		Entry("nothing at all", []string{"doc: fix a link\n"}, "", nil),
	)

	It("leaves kind_hints out of a record that has none", func() {
		r, err := extract.FromEntry(entry(1, "alice", time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)))
		Expect(err).NotTo(HaveOccurred())

		b, err := json.Marshal(r)

		Expect(err).NotTo(HaveOccurred())
		Expect(string(b)).NotTo(ContainSubstring("kind_hints"))
	})

	It("reads the hints from a pull request's commits and description", func() {
		e := entry(1, "alice", time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC))
		e.Body = "- [x] References tracker ticket\nbackport of #69001\n"
		e.Commits = []fetch.Commit{{Message: "x\n\nFixes: https://tracker.ceph.com/issues/90001\n"}}

		r, err := extract.FromEntry(e)

		Expect(err).NotTo(HaveOccurred())
		Expect(r.KindHints).To(Equal(&record.KindHints{
			Checklist: []string{record.CheckReferencesTicket}, Tickets: []int{90001}, BackportOf: 69001,
		}))
	})
})

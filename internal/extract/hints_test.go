package extract_test

import (
	"encoding/json"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/jhoblitt/rook-dev-stats/internal/extract"
	"github.com/jhoblitt/rook-dev-stats/internal/fetch"
	"github.com/jhoblitt/rook-dev-stats/internal/record"
)

// template is the checklist of rook/rook's pull request template, its first
// two boxes ticked. None of its boxes says what kind of change a pull
// request is.
const template = "**Checklist:**\r\n\r\n" +
	"- [x] **Commit Message Formatting**: Commit titles and messages follow guidelines in the developer guide.\r\n" +
	"- [x] Reviewed the developer guide on Submitting a Pull Request\r\n" +
	"- [ ] Pending release notes updated with breaking and/or notable changes for the next minor release.\r\n" +
	"- [ ] Documentation has been updated, if necessary.\r\n" +
	"- [ ] Unit tests have been added, if necessary.\r\n" +
	"- [ ] Integration tests have been added, if necessary.\r\n"

var _ = Describe("Hints", func() {
	DescribeTable("finds the hints",
		func(messages []string, description string, issues []record.Issue, want *record.KindHints) {
			Expect(extract.Hints(16688, "a pull request", messages, description, issues)).To(Equal(want))
		},
		Entry("two closing issues, in GitHub's order, with their labels", nil, "", []record.Issue{
			{Number: 16685, Repository: "rook/rook", Labels: []string{"bug", "ci"}},
			{Number: 16001, Repository: "rook/rook"},
		}, &record.KindHints{Issues: []record.Issue{
			{Number: 16685, Repository: "rook/rook", Labels: []string{"bug", "ci"}},
			{Number: 16001, Repository: "rook/rook"},
		}}),
		Entry("closing issues beside a backport", nil, "backport of #69001", []record.Issue{
			{Number: 4001, Repository: "ceph/ceph-csi", Labels: []string{"bug"}},
		}, &record.KindHints{
			Issues:     []record.Issue{{Number: 4001, Repository: "ceph/ceph-csi", Labels: []string{"bug"}}},
			BackportOf: 69001,
		}),
		Entry("an empty list of closing issues", nil, "", []record.Issue{}, nil),
		Entry("the template with boxes ticked", nil, template, nil, nil),
		Entry("issues named in the commits and description but not closed by the pull request", []string{
			"ci: fix it\n\nFixes: https://github.com/rook/rook/issues/16685\nResolves #16001\n",
		}, "Resolves #16685\r\n", nil, nil),
		Entry("backport of a pull-request URL", nil,
			"backport of https://github.com/ceph/ceph/pull/69001\r\n", nil,
			&record.KindHints{BackportOf: 69001}),
		Entry("Backport of #<digits>, followed by a colon", nil,
			"Backport of: #69001 (clean cherry-pick).", nil,
			&record.KindHints{BackportOf: 69001}),
		Entry("BACKPORT OF a Markdown link to the pull request", nil,
			"This is a BACKPORT OF [#69001](https://github.com/ceph/ceph/pull/69001) to squid.", nil,
			&record.KindHints{BackportOf: 69001}),
		Entry("backport of the first pull request named, the later ones ignored", nil,
			"backport of https://github.com/ceph/ceph/pull/69001, https://github.com/ceph/ceph/pull/69002", nil,
			&record.KindHints{BackportOf: 69001}),
		Entry("backport of with no number", nil,
			"This is a backport of the fix for the listing race.", nil, nil),
		Entry("backport of a pull request in another repository", nil,
			"backport of https://github.com/ceph/ceph-ci/pull/69001", nil, nil),
		Entry("backport of in a commit message rather than the description", []string{
			"rgw: fix it\n\nbackport of https://github.com/ceph/ceph/pull/69001\n",
		}, "", nil, nil),
		Entry("nothing at all", []string{"doc: fix a link\n"}, "", nil, nil),
	)

	It("leaves kind_hints out of a record that has none", func() {
		r, err := extract.FromEntry(entry(1, "alice", time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)))
		Expect(err).NotTo(HaveOccurred())

		b, err := json.Marshal(r)

		Expect(err).NotTo(HaveOccurred())
		Expect(string(b)).NotTo(ContainSubstring("kind_hints"))
	})

	It("reads the hints from a pull request's closing issues and description", func() {
		e := entry(1, "alice", time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC))
		e.Body = "backport of #69001\n"
		e.ClosingIssues = []fetch.ClosingIssue{
			{Number: 16685, Repository: "rook/rook", Labels: []fetch.Label{{Name: "wontfix"}, {Name: "bug"}, {Name: "ci"}}},
			{Number: 4001, Repository: "ceph/ceph-csi", Labels: []fetch.Label{}},
			{Number: 16001, Repository: "rook/rook"},
		}

		r, err := extract.FromEntry(e)

		Expect(err).NotTo(HaveOccurred())
		Expect(r.KindHints).To(Equal(&record.KindHints{
			Issues: []record.Issue{
				{Number: 16685, Repository: "rook/rook", Labels: []string{"bug", "ci", "wontfix"}},
				{Number: 4001, Repository: "ceph/ceph-csi"},
				{Number: 16001, Repository: "rook/rook"},
			},
			BackportOf: 69001,
		}))
	})

	It("skips a closing issue GitHub gave as null: no number or no repository", func() {
		e := entry(1, "alice", time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC))
		e.ClosingIssues = []fetch.ClosingIssue{
			{},
			{Number: 16685, Labels: []fetch.Label{{Name: "bug"}}},
			{Repository: "rook/rook", Labels: []fetch.Label{{Name: "bug"}}},
			{Number: 16001, Repository: "rook/rook"},
		}

		r, err := extract.FromEntry(e)

		Expect(err).NotTo(HaveOccurred())
		Expect(r.KindHints).To(Equal(&record.KindHints{Issues: []record.Issue{{Number: 16001, Repository: "rook/rook"}}}))
	})

	It("leaves kind_hints out when every closing issue is null", func() {
		e := entry(1, "alice", time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC))
		e.ClosingIssues = []fetch.ClosingIssue{{}}

		r, err := extract.FromEntry(e)

		Expect(err).NotTo(HaveOccurred())
		Expect(r.KindHints).To(BeNil())
	})
})

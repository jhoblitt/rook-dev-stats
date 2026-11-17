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
		func(description string, issues []record.Issue, want *record.KindHints) {
			Expect(extract.Hints(16688, "a pull request", description, issues)).To(Equal(want))
		},
		Entry("two closing issues, in GitHub's order, with their labels", "", []record.Issue{
			{Number: 16685, Repository: "rook/rook", Labels: []string{"bug", "ci"}},
			{Number: 16001, Repository: "rook/rook"},
		}, &record.KindHints{Issues: []record.Issue{
			{Number: 16685, Repository: "rook/rook", Labels: []string{"bug", "ci"}},
			{Number: 16001, Repository: "rook/rook"},
		}}),
		Entry("closing issues beside a backport", "backport of #69001", []record.Issue{
			{Number: 4001, Repository: "ceph/ceph-csi", Labels: []string{"bug"}},
		}, &record.KindHints{
			Issues:     []record.Issue{{Number: 4001, Repository: "ceph/ceph-csi", Labels: []string{"bug"}}},
			BackportOf: 69001,
		}),
		Entry("an empty list of closing issues", "", []record.Issue{}, nil),
		Entry("the template with boxes ticked", template, nil, nil),
		Entry("issues named in the description but not closed by the pull request", "Resolves #16685\r\n", nil, nil),
		Entry("backport of a pull-request URL",
			"backport of https://github.com/rook/rook/pull/69001\r\n", nil,
			&record.KindHints{BackportOf: 69001}),
		Entry("Backport of #<digits>, followed by a colon",
			"Backport of: #69001 (clean cherry-pick).", nil,
			&record.KindHints{BackportOf: 69001}),
		Entry("BACKPORT OF a Markdown link to the pull request",
			"This is a BACKPORT OF [#69001](https://github.com/rook/rook/pull/69001) to release-1.18.", nil,
			&record.KindHints{BackportOf: 69001}),
		Entry("backport of the first pull request named, the later ones ignored",
			"backport of https://github.com/rook/rook/pull/69001, https://github.com/rook/rook/pull/69002", nil,
			&record.KindHints{BackportOf: 69001}),
		Entry("backport of with no number",
			"This is a backport of the fix for the listing race.", nil, nil),
		Entry("backport of a pull request in another repository",
			"backport of https://github.com/ceph/ceph-csi/pull/69001", nil, nil),
		Entry("nothing at all", "", nil, nil),
	)

	// The pull request under test is #16688 throughout.
	DescribeTable("names the pull request a backport copies",
		func(title, description string, want int) {
			var got int
			if h := extract.Hints(16688, title, description, nil); h != nil {
				got = h.BackportOf
			}
			Expect(got).To(Equal(want))
		},
		Entry("Mergify's description sentence alone", "core: fix it",
			"This is an automatic backport of pull request #18708 done by [Mergify](https://mergify.com).", 18708),
		Entry("Mergify's sentence after the original's description, joined by <hr>", "core: fix it",
			"Fixes #18700\r\n\r\n- [x] Unit tests have been added, if necessary.<hr>This is an automatic backport of pull request #18708 done by [Mergify](https://mergify.com).", 18708),
		Entry("an older Mergify's \"automated\" sentence, plain Mergify after", "core: fix it",
			"This is an automated backport of pull request #5000 done by Mergify.io", 5000),
		Entry("Mergify's sentence in any case", "core: fix it",
			"THIS IS AN AUTOMATIC BACKPORT OF PULL REQUEST #18708 done by Mergify.", 18708),
		Entry("a backport of a backport: the first sentence, the original's", "core: fix it (backport #18735)",
			"<hr>This is an automatic backport of pull request #18708 done by [Mergify](https://mergify.com).<hr>This is an automatic backport of pull request #18735 done by [Mergify](https://mergify.com).", 18708),
		Entry("the title suffix alone", "core: fix it (backport #18708)", "", 18708),
		Entry("the title suffix followed by whitespace", "core: fix it (backport #18708) \t", "", 18708),
		Entry("the title suffix in any case", "core: fix it (Backport #18708)", "", 18708),
		Entry("the title suffix with no space before #", "core: fix it (backport#18708)", "", 18708),
		Entry("the title suffix without #", "core: fix it (backport 18708)", "", 18708),
		Entry("the title suffix joined by a hyphen", "core: fix it (backport-18708)", "", 18708),
		Entry("the title suffix naming several: the first", "core: fix it (backport #18708, #18709, and #18710)", "", 18708),
		Entry("an older Mergify's title suffix, bp for backport", "core: fix it (bp #6950)", "", 6950),
		Entry("bp with no space before #", "core: fix it (bp#6950)", "", 6950),
		Entry("bp naming a branch after the pull request", "core: fix it (bp #6950 on release-1.5)", "", 6950),
		Entry("bp naming several: the first", "core: fix it (bp #6950 #6951)", "", 6950),
		Entry("a title that names a backport but not at its end", "core: fix it (backport #18708) again", "", 0),
		Entry("a title suffix with no number", "core: fix it (backport)", "", 0),
		Entry("a title suffix naming a version, not a pull request", "core: fix it (backport 1.5)", "", 0),
		Entry("a title suffix naming a version after #N: the pull request", "core: fix it (backport #18708 to 1.5)", "", 18708),
		Entry("a title suffix naming a version, the space dropped", "core: fix it (backport1.15)", "", 0),
		Entry("the description's sentence and a different title suffix: the description's", "core: fix it (backport #18735)",
			"This is an automatic backport of pull request #18708 done by [Mergify](https://mergify.com).", 18708),
		Entry("Mergify's sentence before an earlier backport of", "core: fix it",
			"backport of #100\n<hr>This is an automatic backport of pull request #18708 done by [Mergify](https://mergify.com).", 18708),
		Entry("backport of a Rook pull-request address", "core: fix it",
			"backport of https://github.com/rook/rook/pull/123", 123),
		Entry("backport of another repository's pull-request address", "core: fix it",
			"backport of https://github.com/rook/kubectl-rook-ceph/pull/123", 0),
		Entry("a title suffix naming the pull request itself", "core: fix it (backport #16688)", "", 0),
		Entry("backport of #0", "core: fix it", "backport of #0", 0),
		Entry("a description naming the pull request itself, then a title suffix naming another", "core: fix it (backport #18708)",
			"This is an automatic backport of pull request #16688 done by [Mergify](https://mergify.com).", 18708),
		Entry("Mergify's sentence naming the pull request itself, then a backport of naming another", "core: fix it (backport #18735)",
			"backport of #18708\n<hr>This is an automatic backport of pull request #16688 done by [Mergify](https://mergify.com).", 18708),
		Entry("a backport of naming the pull request itself, then a title suffix naming another", "core: fix it (backport #18708)",
			"backport of #16688", 18708),
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

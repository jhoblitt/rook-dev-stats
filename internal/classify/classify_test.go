package classify_test

import (
	"os"
	"path/filepath"
	"slices"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/jhoblitt/rook-dev-stats/internal/classify"
	"github.com/jhoblitt/rook-dev-stats/internal/fetch"
	"github.com/jhoblitt/rook-dev-stats/internal/record"
	"github.com/jhoblitt/rook-dev-stats/internal/tables"
)

var _ = Describe("Records", func() {
	var t *tables.Tables

	BeforeEach(func() {
		t = loadTables(nil)
	})

	one := func(r record.Record) classify.PR {
		GinkgoHelper()
		prs := classify.Records(t, []record.Record{r})
		Expect(prs).To(HaveLen(1))
		Expect(prs[0].Number).To(Equal(r.Number))
		return prs[0]
	}

	Describe("the author", func() {
		DescribeTable("is human unless GitHub types it a bot or bots.yaml lists it",
			func(author record.Actor, want bool) {
				r := pr(1)
				r.Author = author
				Expect(one(r).AuthorHuman).To(Equal(want))
			},
			Entry("a person", record.Actor{Login: "alice"}, true),
			Entry("an account GitHub types a bot", record.Actor{Login: "dependabot", Bot: true}, false),
			Entry("an account bots.yaml lists, in another case", record.Actor{Login: "ci-user"}, false),
			Entry("a deleted account", record.Actor{Login: fetch.GhostLogin}, true),
		)
	})

	Describe("comment kinds", func() {
		DescribeTable("take the first kind that applies",
			func(c record.Comment, want classify.Comment) {
				r := pr(1)
				r.Comments = []record.Comment{c}
				Expect(one(r).Comments).To(Equal([]classify.Comment{want}))
			},
			Entry("a bot account",
				record.Comment{By: "github-actions", Bot: true, Text: "build passed"},
				classify.Comment{Kind: classify.BotAccount}),
			Entry("a bot account posting command text is a bot account",
				record.Comment{By: "jenkins", Bot: true, Text: "jenkins test make check"},
				classify.Comment{Kind: classify.BotAccount}),
			Entry("an account bots.yaml lists posting command text is a bot account",
				record.Comment{By: "CI-User", Text: "jenkins test make check"},
				classify.Comment{Kind: classify.BotAccount}),
			Entry("the author posting a command is a command, not an author comment",
				record.Comment{By: "alice", Text: "jenkins test make check"},
				classify.Comment{Kind: classify.CommandAuthor, Command: "make-check"}),
			Entry("another person posting a command in another case",
				record.Comment{By: "bob", Text: "Jenkins retest this please"},
				classify.Comment{Kind: classify.CommandOther, Command: "retest"}),
			Entry("the author",
				record.Comment{By: "alice", Text: "rebased"},
				classify.Comment{Kind: classify.CommentAuthor}),
			Entry("the author, in a comment too long to keep its text",
				record.Comment{By: "alice"},
				classify.Comment{Kind: classify.CommentAuthor}),
			Entry("another person",
				record.Comment{By: "bob", Text: "LGTM"},
				classify.Comment{Kind: classify.CommentOther}),
		)

		It("keeps the comments' order", func() {
			r := pr(1)
			r.Comments = []record.Comment{{By: "bob"}, {By: "alice"}, {By: "dependabot", Bot: true}}
			Expect(one(r).Comments).To(Equal([]classify.Comment{
				{Kind: classify.CommentOther}, {Kind: classify.CommentAuthor}, {Kind: classify.BotAccount},
			}))
		})

		DescribeTable("never take a deleted account for the author, even on a deleted account's PR",
			func(author record.Actor) {
				r := pr(1)
				r.Author = author
				r.Comments = []record.Comment{
					{By: fetch.GhostLogin, Text: "thanks"},
					{By: fetch.GhostLogin, Text: "jenkins test make check"},
				}
				r.Reviews = []record.Review{{By: fetch.GhostLogin, State: record.ReviewApproved}}

				got := one(r)
				Expect(got.AuthorHuman).To(BeTrue())
				Expect(got.Comments).To(Equal([]classify.Comment{
					{Kind: classify.CommentOther},
					{Kind: classify.CommandOther, Command: "make-check"},
				}))
				Expect(got.Reviews).To(Equal([]classify.Review{{Human: true, Other: true}}))
			},
			Entry("one with no name", record.Actor{Login: fetch.GhostLogin}),
			Entry("one named by its commits, still not known to be the commenter", record.Actor{Login: fetch.GhostLogin, Name: "Ivy Example"}),
		)
	})

	Describe("reviews", func() {
		It("say whether each is by a human, and by a human other than the author", func() {
			r := pr(1)
			r.Reviews = []record.Review{
				{By: "bob", State: record.ReviewApproved},
				{By: "alice", State: record.ReviewCommented},
				{By: "copilot-pull-request-reviewer", Bot: true, State: record.ReviewCommented},
				{By: "ci-user", State: record.ReviewCommented},
			}
			Expect(one(r).Reviews).To(Equal([]classify.Review{
				{Human: true, Other: true},
				{Human: true, Other: false},
				{Human: false, Other: false},
				{Human: false, Other: false},
			}))
		})
	})

	Describe("disclosure", func() {
		DescribeTable("is the highest class present, with the families of what counts",
			func(d record.Disclosure, class string, families []string) {
				r := pr(1)
				r.Disclosure = d
				got := one(r)
				Expect(got.Disclosure).To(Equal(class))
				Expect(got.Families).To(Equal(families))
			},
			Entry("nothing", record.Disclosure{}, classify.DisclosureNone, nil),
			Entry("a trailer whose key is listed",
				record.Disclosure{Trailers: []string{"Assisted-by: Claude Code"}},
				classify.DisclosureTrailer, []string{"claude"}),
			Entry("a trailer whose key is listed, in another case",
				record.Disclosure{Trailers: []string{"ASSISTED-BY: Gemini"}},
				classify.DisclosureTrailer, []string{"gemini"}),
			Entry("a kept Co-authored-by",
				record.Disclosure{Trailers: []string{"Co-authored-by: Cursor <cursoragent@cursor.com>"}},
				classify.DisclosureCoauthor, []string{"cursor"}),
			Entry("a description line with a phrase",
				record.Disclosure{Description: []string{"🤖 Generated with [Claude Code](https://claude.com)"}},
				classify.DisclosureDescription, []string{"claude"}),
			Entry("a commit-prose line with a phrase",
				record.Disclosure{CommitProse: []string{"Assisted by an LLM"}},
				classify.DisclosureDescription, []string{"unspecified"}),
			Entry("a tool's name alone",
				record.Disclosure{Description: []string{"Address Claude review comments"}, CommitProse: []string{"gemini: fix"}},
				classify.DisclosureNone, nil),
			Entry("a trailer whose key is not listed",
				record.Disclosure{Trailers: []string{"Generated-by: Claude"}},
				classify.DisclosureNone, nil),
			Entry("an ignored trailer",
				record.Disclosure{Trailers: []string{"Assisted-by: nobody"}},
				classify.DisclosureNone, nil),
			Entry("an ignored Co-authored-by naming a person like a tool",
				record.Disclosure{Trailers: []string{"Co-authored-by: Claude Dupont <c@example.com>"}},
				classify.DisclosureNone, nil),
			Entry("an ignored description line with a phrase",
				record.Disclosure{Description: []string{"Generated with care"}},
				classify.DisclosureNone, nil),
			Entry("a trailer over a co-author over a description, families in table order",
				record.Disclosure{
					Trailers:    []string{"Assisted-by: Gemini", "Co-authored-by: Claude <noreply@anthropic.com>"},
					Description: []string{"Generated with Cursor"},
				},
				classify.DisclosureTrailer, []string{"cursor", "claude", "gemini"}),
			Entry("unspecified beside a named tool is dropped, whatever names it",
				record.Disclosure{
					Trailers:    []string{"Assisted-by: an LLM"},
					Description: []string{"Generated with Gemini"},
					CommitProse: []string{"Assisted by an LLM"},
				},
				classify.DisclosureTrailer, []string{"gemini"}),
			Entry("unspecified from several lines that name no tool is kept",
				record.Disclosure{
					Description: []string{"Generated with an LLM"},
					CommitProse: []string{"Assisted by an LLM"},
				},
				classify.DisclosureDescription, []string{"unspecified"}),
			Entry("unspecified beside a counted line that names no family is kept",
				record.Disclosure{
					Trailers:    []string{"Assisted-by: Bard"},
					Description: []string{"Assisted by an LLM"},
				},
				classify.DisclosureTrailer, []string{"unspecified"}),
			Entry("a co-author over a description",
				record.Disclosure{
					Trailers:    []string{"Co-authored-by: Claude <noreply@anthropic.com>"},
					Description: []string{"Generated with Gemini"},
				},
				classify.DisclosureCoauthor, []string{"claude", "gemini"}),
			Entry("one line naming two tools gives the first family only",
				record.Disclosure{Trailers: []string{"Assisted-by: Cursor (Claude 4)"}},
				classify.DisclosureTrailer, []string{"cursor"}),
		)

		DescribeTable("comes from single lines only, never from neighboring lines that match a phrase when joined",
			func(d record.Disclosure, class string, families []string) {
				r := pr(1)
				r.Disclosure = d
				got := one(r)
				Expect(got.Disclosure).To(Equal(class))
				Expect(got.Families).To(Equal(families))
			},
			Entry("in the description",
				record.Disclosure{Description: []string{"The unit tests were generated", "with an LLM and then reviewed."}},
				classify.DisclosureNone, nil),
			Entry("in the commit prose",
				record.Disclosure{CommitProse: []string{"Docs assisted", "by Gemini."}},
				classify.DisclosureNone, nil),
			Entry("beside a line that counts alone, whose family is kept",
				record.Disclosure{Description: []string{"Assisted by an LLM", "Address Claude review comments"}},
				classify.DisclosureDescription, []string{"unspecified"}),
		)

		It("stays none for two commits' lines that the data's tables would match only when joined", func() {
			b, err := os.ReadFile(filepath.Join("..", "..", "data", tables.ToolsFile))
			Expect(err).NotTo(HaveOccurred())
			t = loadTables(map[string]string{tables.ToolsFile: string(b)})
			r := pr(1)
			r.Disclosure.CommitProse = []string{"Addressed review comments from Copilot", "Wrote unit tests for the LLM gateway"}
			Expect(t.Tools.Phrase(r.Disclosure.CommitProse[0]+" "+r.Disclosure.CommitProse[1])).To(BeTrue(), "the joined lines match a phrase")
			got := one(r)
			Expect(got.Disclosure).To(Equal(classify.DisclosureNone))
			Expect(got.Families).To(BeEmpty())
		})

		It("gives the verdict on every candidate", func() {
			r := pr(1)
			r.Disclosure = record.Disclosure{
				Trailers:    []string{"Assisted-by: Claude", "Generated-by: Claude", "Assisted-by: nobody", "Assisted-by: Bard"},
				Description: []string{"Generated with Gemini"},
				CommitProse: []string{"Address Claude review comments"},
			}
			Expect(one(r).Candidates).To(Equal([]classify.Candidate{
				{Text: "Assisted-by: Claude", From: classify.FromTrailers, Class: classify.DisclosureTrailer, Family: "claude"},
				{Text: "Generated-by: Claude", From: classify.FromTrailers},
				{Text: "Assisted-by: nobody", From: classify.FromTrailers, Ignored: true},
				{Text: "Assisted-by: Bard", From: classify.FromTrailers, Class: classify.DisclosureTrailer},
				{Text: "Generated with Gemini", From: classify.FromDescription, Class: classify.DisclosureDescription, Family: "gemini"},
				{Text: "Address Claude review comments", From: classify.FromCommitProse},
			}))
		})
	})

	Describe("components", func() {
		It("are the components whose labels the PR carries, in table order", func() {
			r := pr(1)
			r.Labels = []string{"cephfs", "needs-review", "rgw-multisite"}
			Expect(one(r).Components).To(Equal([]string{"rgw", "cephfs"}))
		})

		It("are none without a component label", func() {
			r := pr(1)
			r.Labels = []string{"needs-review"}
			Expect(one(r).Components).To(BeEmpty())
		})
	})

	Describe("kind", func() {
		kindOf := func(recs ...record.Record) []classify.PR {
			GinkgoHelper()
			return classify.Records(t, recs)
		}

		withHints := func(n int, h record.KindHints, labels ...string) record.Record {
			r := pr(n)
			r.KindHints = &h
			r.Labels = append(r.Labels, labels...)
			return r
		}

		// issue is an issue of the records' own repository.
		issue := func(n int, labels ...string) record.Issue {
			return record.Issue{Number: n, Repository: "rook/rook", Labels: labels}
		}

		closes := func(issues ...record.Issue) record.KindHints {
			return record.KindHints{Issues: issues}
		}

		DescribeTable("comes from the first source in the table's order that gives one",
			func(r record.Record, kind, source string) {
				got := kindOf(r)[0]
				Expect(got.Kind).To(Equal(kind))
				Expect(got.KindSource).To(Equal(source))
			},
			Entry("no hints", pr(1), "", ""),
			Entry("kind labels that agree",
				withHints(1, record.KindHints{}, "bug-fix", "rgw"),
				"bugfix", tables.SourceLabels),
			Entry("kind labels that disagree",
				withHints(1, record.KindHints{}, "bug-fix", "feature"),
				"", ""),
			Entry("a label before a closing issue",
				withHints(1, closes(issue(7, "feature")), "dependencies"),
				"other", tables.SourceLabels),
			Entry("kind labels that disagree leave the closing issue to decide",
				withHints(1, closes(issue(7, "docs")), "bug-fix", "feature"),
				"docs", tables.SourceIssues),
			Entry("an issue whose labels disagree gives nothing, so the next issue decides",
				withHints(1, closes(issue(7, "bug", "feature"), issue(8, "feature"))),
				"feature", tables.SourceIssues),
			Entry("an issue with no kind label gives nothing, so the next issue decides",
				withHints(1, closes(issue(7, "wontfix"), issue(8), issue(9, "bug", "csi"))),
				"bugfix", tables.SourceIssues),
			Entry("an issue's labels map by issue_labels, not labels",
				withHints(1, closes(issue(7, "bug-fix"))),
				"", ""),
			Entry("an issue of another repository never decides",
				withHints(1, closes(record.Issue{Number: 7, Repository: "ceph/ceph-csi", Labels: []string{"bug"}})),
				"", ""),
			Entry("an issue of another repository is passed over for the next",
				withHints(1, closes(
					record.Issue{Number: 7, Repository: "ceph/ceph-csi", Labels: []string{"bug"}},
					issue(8, "feature"),
				)),
				"feature", tables.SourceIssues),
			Entry("issues that all disagree",
				withHints(1, closes(issue(7, "bug", "docs"), issue(8, "feature", "bug"))),
				"", ""),
		)

		It("follows the table's order", func() {
			t = loadTables(map[string]string{tables.KindsFile: `
kinds: [{id: bugfix, name: Bug fix}, {id: feature, name: Feature}]
labels: {bug-fix: bugfix}
issue_labels: {feature: feature}
order: [issues, labels]
`})
			got := kindOf(
				withHints(1, closes(issue(7, "feature")), "bug-fix"),
				withHints(2, closes(issue(7)), "bug-fix"),
			)
			Expect(got[0]).To(And(HaveField("Kind", "feature"), HaveField("KindSource", tables.SourceIssues)))
			Expect(got[1]).To(And(HaveField("Kind", "bugfix"), HaveField("KindSource", tables.SourceLabels)))
		})

		It("leaves out a source the order does not name", func() {
			t = loadTables(map[string]string{tables.KindsFile: `
kinds: [{id: feature, name: Feature}]
issue_labels: {feature: feature}
order: [labels]
`})
			got := kindOf(withHints(1, closes(issue(7, "feature"))))
			Expect(got[0]).To(And(HaveField("Kind", ""), HaveField("KindSource", "")), "issues is not in the order")
		})

		Describe("of a backport", func() {
			It("is its original's kind, before its own sources", func() {
				got := kindOf(
					withHints(1, closes(issue(7, "feature"))),
					withHints(2, record.KindHints{BackportOf: 1}, "bug-fix"),
				)
				Expect(got[1]).To(And(HaveField("Kind", "feature"), HaveField("KindSource", classify.SourceOriginal)))
			})

			It("is its original's kind when the original took its own from its original", func() {
				got := kindOf(
					withHints(1, closes(issue(7, "docs"))),
					withHints(2, record.KindHints{BackportOf: 1}),
					withHints(3, record.KindHints{BackportOf: 2}, "bug-fix"),
				)
				Expect(got[1]).To(And(HaveField("Kind", "docs"), HaveField("KindSource", classify.SourceOriginal)))
				Expect(got[2]).To(And(HaveField("Kind", "docs"), HaveField("KindSource", classify.SourceOriginal)))
			})

			It("comes from its own sources when the original is not in the records", func() {
				got := kindOf(withHints(2, record.KindHints{BackportOf: 1}, "bug-fix"))
				Expect(got[0]).To(And(HaveField("Kind", "bugfix"), HaveField("KindSource", tables.SourceLabels)))
			})

			It("comes from its own sources when the original has no kind", func() {
				got := kindOf(pr(1), withHints(2, record.KindHints{BackportOf: 1}, "bug-fix"))
				Expect(got[1]).To(And(HaveField("Kind", "bugfix"), HaveField("KindSource", tables.SourceLabels)))
			})

			It("comes from its own sources when it names itself", func() {
				got := kindOf(withHints(1, record.KindHints{Issues: []record.Issue{issue(7, "bug")}, BackportOf: 1}))
				Expect(got[0]).To(And(HaveField("Kind", "bugfix"), HaveField("KindSource", tables.SourceIssues)))
			})

			It("comes from its own sources when the backports form a cycle", func() {
				got := kindOf(
					withHints(1, record.KindHints{Issues: []record.Issue{issue(7, "feature")}, BackportOf: 2}),
					withHints(2, record.KindHints{BackportOf: 1}, "bug-fix"),
					withHints(3, record.KindHints{BackportOf: 1}),
				)
				Expect(got[0]).To(And(HaveField("Kind", "feature"), HaveField("KindSource", tables.SourceIssues)))
				Expect(got[1]).To(And(HaveField("Kind", "bugfix"), HaveField("KindSource", tables.SourceLabels)))
				Expect(got[2]).To(And(HaveField("Kind", "feature"), HaveField("KindSource", classify.SourceOriginal)),
					"a backport of a PR in a cycle")
			})

			It("does not depend on the order of the records", func() {
				recs := []record.Record{
					withHints(1, record.KindHints{Issues: []record.Issue{issue(7, "feature")}, BackportOf: 2}),
					withHints(2, record.KindHints{BackportOf: 1}, "bug-fix"),
					withHints(3, record.KindHints{BackportOf: 1}),
					withHints(4, record.KindHints{BackportOf: 3}),
				}
				forward := kindOf(recs...)
				slices.Reverse(recs)
				backward := kindOf(recs...)
				slices.Reverse(backward)
				Expect(backward).To(Equal(forward))
			})
		})
	})
})

package classify_test

import (
	"bytes"
	"strings"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/jhoblitt/rook-dev-stats/internal/classify"
	"github.com/jhoblitt/rook-dev-stats/internal/fetch"
	"github.com/jhoblitt/rook-dev-stats/internal/record"
	"github.com/jhoblitt/rook-dev-stats/internal/tables"
)

var _ = Describe("Check", func() {
	var (
		in  classify.CheckInput
		out *bytes.Buffer
	)

	// meta's window falls between the clean dataset's PR opened on May 1
	// and the others, opened on June 1, so that one is not counted.
	meta := func(openedInWindow, open int) *record.Meta {
		return &record.Meta{
			WindowStart:  time.Date(2026, 5, 15, 0, 0, 0, 0, time.UTC),
			GitHubCounts: record.Counts{OpenedInWindow: openedInWindow, Open: open},
		}
	}

	// clean is a small dataset every check passes on.
	clean := func() classify.CheckInput {
		r1 := pr(1)
		r1.Labels = []string{"needs-review", "rgw"}
		r1.Disclosure.Trailers = []string{"Assisted-by: Claude Code", "Co-authored-by: Cursor <cursoragent@cursor.com>"}
		r1.Disclosure.Description = []string{"Address Claude review comments"}
		r1.Comments = []record.Comment{
			{By: "alice", Text: "jenkins test make check"},
			{By: "bob", Text: "LGTM"},
			{By: "bob", Text: "lgtm"},
			{By: "dependabot", Bot: true, Text: "rebased"},
			{By: "ci-user", Text: "retest"},
		}
		r1.KindHints = &record.KindHints{Issues: []record.Issue{{Number: 7, Repository: "rook/rook", Labels: []string{"bug"}}}}

		r2 := pr(2)
		r2.Base = "squid"
		r2.Created = time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
		r2.State = record.StateMerged
		r2.Labels = []string{"rgw", "squid"}
		r2.Disclosure.Description = []string{"Address Claude review comments", "GPT partition table"}
		r2.Comments = []record.Comment{{By: "bob", Text: "LGTM"}, {By: "carol"}}

		r3 := pr(3)
		r3.State = record.StateMerged

		return classify.CheckInput{
			Tables:  loadTables(nil),
			Records: []record.Record{r1, r2, r3},
			Meta:    meta(2, 1),
			Top:     10,
		}
	}

	BeforeEach(func() {
		in = clean()
		out = &bytes.Buffer{}
	})

	It("passes a clean dataset and reports on it", func() {
		Expect(classify.Check(in, out)).To(Succeed())
		Expect(out.String()).To(Equal(`Counts: 2 opened in the window (GitHub's search: 2), 1 open (GitHub's listing: 1)
Pull requests by deleted accounts: 0, named from their commits: 0, distinct names: 0
Trailers with an unlisted key and no ignore entry: 0
Counted disclosures that match no family: 0
Neighboring candidates that match a phrase only when joined: 0
Description and commit-prose candidates that match no phrase: 2
      2  Address Claude review comments
      1  GPT partition table
Short comments by people that match no command: 1
      3  lgtm
Accounts with the most comments, not typed bots by GitHub: 4
      3  bob
      1  alice
      1  carol
      1  ci-user (bots.yaml)
Base branches: 2
      2  main
      1  squid
`))
	})

	It("passes the tables alone, with no records or meta", func() {
		Expect(classify.Check(classify.CheckInput{Tables: in.Tables}, out)).To(Succeed())
		Expect(out.String()).To(Equal(`Counts: no meta.json to compare with
Pull requests by deleted accounts: 0, named from their commits: 0, distinct names: 0
Trailers with an unlisted key and no ignore entry: 0
Counted disclosures that match no family: 0
Neighboring candidates that match a phrase only when joined: 0
Description and commit-prose candidates that match no phrase: 0
Short comments by people that match no command: 0
Accounts with the most comments, not typed bots by GitHub: 0
Base branches: 0
`))
	})

	DescribeTable("compares the counts over every record when the window is the default",
		func(windowStart time.Time) {
			in.Records[0].Created = time.Date(2016, 7, 22, 0, 0, 0, 0, time.UTC)
			in.Records[1].Created = time.Date(2018, 3, 1, 0, 0, 0, 0, time.UTC)
			in.Meta = &record.Meta{WindowStart: windowStart, GitHubCounts: record.Counts{OpenedInWindow: 3, Open: 1}}

			Expect(classify.Check(in, out)).To(Succeed())
			Expect(out.String()).To(HavePrefix("Counts: 3 opened in the window (GitHub's search: 3), 1 open (GitHub's listing: 1)\n"))
		},
		Entry("meta.json's window_start, as extract writes it", fetch.WindowStart),
		Entry("a meta.json without window_start", time.Time{}),
	)

	DescribeTable("names the count of pull requests opened in the window it compared with",
		func(source record.CountSource, line, problem string, warns bool) {
			in.Meta = meta(1, 1)
			in.Meta.GitHubCounts.OpenedInWindowSource = source

			err := classify.Check(in, out)

			Expect(out.String()).To(HavePrefix(line + "\n"))
			Expect(err).To(MatchError(ContainSubstring(problem)))
			const warning = "GitHub's search has been seen to omit pull requests that its listing returns"
			if warns {
				Expect(err).To(MatchError(ContainSubstring(problem + "; " + warning)))
			} else {
				Expect(err).NotTo(MatchError(ContainSubstring(warning)))
			}
		},
		Entry("the search, warning that it can omit pull requests", record.SourceSearch,
			"Counts: 2 opened in the window (GitHub's search: 1), 1 open (GitHub's listing: 1)",
			"meta.json: the records hold 2 pull requests opened in the window, GitHub's search counted 1: more than 0.5% apart", true),
		Entry("the search, for a meta.json that records no source", record.CountSource(""),
			"Counts: 2 opened in the window (GitHub's search: 1), 1 open (GitHub's listing: 1)",
			"meta.json: the records hold 2 pull requests opened in the window, GitHub's search counted 1: more than 0.5% apart", true),
		Entry("the listing, with no warning", record.SourceListing,
			"Counts: 2 opened in the window (GitHub's listing: 1), 1 open (GitHub's listing: 1)",
			"meta.json: the records hold 2 pull requests opened in the window, GitHub's listing counted 1: more than 0.5% apart", false),
	)

	DescribeTable("allows the records and GitHub's count of pull requests opened in the window 0.5% apart, whichever count it is",
		func(source record.CountSource, github int, passes bool) {
			for i := range 197 {
				in.Records = append(in.Records, pr(10+i))
			}
			in.Meta = meta(github, 198)
			in.Meta.GitHubCounts.OpenedInWindowSource = source

			err := classify.Check(in, out)

			if passes {
				Expect(err).NotTo(HaveOccurred())
			} else {
				Expect(err).To(MatchError(ContainSubstring("the records hold 199 pull requests opened in the window")))
			}
		},
		Entry("the search, 0.5% apart", record.SourceSearch, 200, true),
		Entry("the search, 1% apart", record.SourceSearch, 201, false),
		Entry("the listing, 0.5% apart", record.SourceListing, 200, true),
		Entry("the listing, 1% apart", record.SourceListing, 201, false),
	)

	It("hints at neighboring candidates that match a phrase only when joined, without failing", func() {
		in.Records[1].Disclosure.Description = []string{"Docs assisted", "by Gemini."}
		in.Records[2].Disclosure.Description = []string{"Docs assisted", "by Gemini."}
		in.Records[2].Disclosure.CommitProse = []string{"Docs assisted", "by Gemini."}
		Expect(classify.Check(in, out)).To(Succeed())
		Expect(out.String()).To(ContainSubstring(`Neighboring candidates that match a phrase only when joined: 1
    For a real disclosure, add a phrase to tools.yaml that one of its lines matches alone.
    Docs assisted by Gemini. (#2, #3)
Description`))
	})

	It("hints at no pair with an ignored line, a line that counts alone, or lines of two sources", func() {
		in.Records[0].Disclosure.Description = []string{"Docs assisted"}
		in.Records[0].Disclosure.CommitProse = []string{"by Gemini."}
		in.Records[1].Disclosure.Description = []string{"Docs assisted", "by Gemini, said nobody"}
		in.Records[1].Disclosure.CommitProse = []string{"Generated with care", "by Gemini."}
		in.Records[2].Disclosure.CommitProse = []string{"Assisted by an LLM", "by Gemini."}
		in.Records[2].Disclosure.Description = []string{"Docs", "assisted by an LLM"}
		Expect(classify.Check(in, out)).To(Succeed())
		Expect(out.String()).To(ContainSubstring("Neighboring candidates that match a phrase only when joined: 0\n"))
	})

	It("counts the deleted accounts' pull requests, those named and the names, printing no name and failing on none", func() {
		for i, name := range []string{"Ivy Example", "", "Kim Example", "Ivy Example"} {
			r := pr(10 + i)
			r.Author = record.Actor{Login: fetch.GhostLogin, Name: name}
			r.Comments = []record.Comment{{By: fetch.GhostLogin, Text: "thanks"}}
			in.Records = append(in.Records, r)
		}
		in.Records[0].Comments = append(in.Records[0].Comments, record.Comment{By: fetch.GhostLogin})
		in.Meta = meta(6, 5)

		Expect(classify.Check(in, out)).To(Succeed())

		Expect(out.String()).To(ContainSubstring("\nPull requests by deleted accounts: 4, named from their commits: 3, distinct names: 2\n"))
		Expect(out.String()).NotTo(Or(ContainSubstring("Ivy"), ContainSubstring("Kim")))
	})

	It("cuts each report at the top entries", func() {
		in.Top = 1
		Expect(classify.Check(in, out)).To(Succeed())
		Expect(out.String()).To(ContainSubstring(`Accounts with the most comments, not typed bots by GitHub: 4
      3  bob
    and 3 more
`))
	})

	DescribeTable("passes",
		func(change func()) {
			change()
			Expect(classify.Check(in, out)).To(Succeed())
		},
		Entry("a trailer whose key is listed, in another case", func() {
			in.Records[2].Disclosure.Trailers = []string{"ASSISTED-BY: Gemini"}
		}),
		Entry("a Co-authored-by in another case", func() {
			in.Records[2].Disclosure.Trailers = []string{"CO-AUTHORED-BY: Claude"}
		}),
		Entry("a trailer with an unlisted key that ignore lists", func() {
			in.Records[2].Disclosure.Trailers = []string{"Made-with: Claude Dupont"}
		}),
		Entry("an unclassified label on 4 PRs", func() {
			for i := range 4 {
				in.Records = append(in.Records, pr(10+i))
				in.Records[len(in.Records)-1].Labels = []string{"core"}
			}
			in.Meta = meta(6, 5)
		}),
		Entry("a kind label on 5 PRs", func() {
			for i := range 5 {
				in.Records = append(in.Records, pr(10+i))
				in.Records[len(in.Records)-1].Labels = []string{"bug-fix"}
			}
			in.Meta = meta(7, 6)
		}),
		Entry("counts 0.5% apart", func() {
			for i := range 197 {
				in.Records = append(in.Records, pr(10+i))
			}
			in.Meta = meta(200, 198)
		}),
	)

	DescribeTable("fails, naming the problem",
		func(change func(), want string) {
			change()
			Expect(classify.Check(in, out)).To(MatchError(ContainSubstring(want)))
		},
		Entry("a trailer whose key is neither listed nor Co-authored-by", func() {
			in.Records[2].Disclosure.Trailers = []string{"Generated-by: Claude"}
		}, `tools.yaml: trailer key "generated-by" is not in trailer_keys or Co-authored-by, and no ignore entry lists a line with it (1 line, #3)`),
		Entry("a counted trailer that matches no family", func() {
			in.Records[2].Disclosure.Trailers = []string{"Assisted-by: Bard"}
		}, `tools.yaml: no family matches a counted disclosure with the trailer key "assisted-by" (1 line, #3)`),
		Entry("a counted description line that matches no family", func() {
			in.Records[2].Disclosure.Description = []string{"Assisted by Bard"}
		}, `tools.yaml: no family matches a counted description or commit-prose disclosure (1 line, #3)`),
		Entry("an unclassified label on 5 PRs", func() {
			for i := range 5 {
				in.Records = append(in.Records, pr(10+i))
				in.Records[len(in.Records)-1].Labels = []string{"core"}
			}
			in.Meta = meta(7, 6)
		}, `labels.yaml: label "core" is on 5 pull requests and no table classifies it`),
		Entry("more PRs opened in the window than GitHub counted", func() {
			in.Meta = meta(1, 1)
		}, `meta.json: the records hold 2 pull requests opened in the window, GitHub's search counted 1: more than 0.5% apart`),
		Entry("fewer open PRs than GitHub counted", func() {
			in.Meta = meta(2, 300)
		}, `meta.json: the records hold 1 open pull requests, GitHub's listing counted 300: more than 0.5% apart`),
		Entry("counts 1% apart", func() {
			for i := range 196 {
				in.Records = append(in.Records, pr(10+i))
			}
			in.Meta = meta(200, 197)
		}, `the records hold 198 pull requests opened in the window, GitHub's search counted 200`),
	)

	It("fails when tools.yaml has no unspecified family, which a disclosure naming no tool needs", func() {
		tools := strings.Replace(specTables[tables.ToolsFile], "  - {id: unspecified, name: Unspecified, patterns: ['\\bllm\\b']}\n", "", 1)
		Expect(tools).NotTo(Equal(specTables[tables.ToolsFile]), "the spec tables changed")
		in.Tables = loadTables(map[string]string{tables.ToolsFile: tools})
		Expect(classify.Check(in, out)).To(MatchError(
			`tools.yaml: no family has the id "unspecified", which a disclosure that names no tool is counted under`))
	})

	It("names at most five PRs for one problem", func() {
		for i := range in.Records {
			in.Records[i].Disclosure.Trailers = []string{"Assisted-by: Bard"}
		}
		for i := range 4 {
			in.Records = append(in.Records, pr(10+i))
			in.Records[len(in.Records)-1].Disclosure.Trailers = []string{"Assisted-by: Bard"}
		}
		in.Meta = nil
		Expect(classify.Check(in, out)).To(MatchError(
			`tools.yaml: no family matches a counted disclosure with the trailer key "assisted-by" (1 line, #1, #2, #3, #10, #11 and 2 more)`))
	})

	It("names a PR once when its lists repeat a line", func() {
		in.Records[2].Disclosure.Description = []string{"Assisted by Bard"}
		in.Records[2].Disclosure.CommitProse = []string{"Assisted by Bard"}
		Expect(classify.Check(in, out)).To(MatchError(
			`tools.yaml: no family matches a counted description or commit-prose disclosure (1 line, #3)`))
	})

	It("groups the lines of one trailer key, in any case, counting each line and each PR once", func() {
		in.Records[1].Disclosure.Trailers = []string{"Assisted-by: Bard", "ASSISTED-BY: Bard 2"}
		in.Records[2].Disclosure.Trailers = []string{"Assisted-by: Bard"}
		Expect(classify.Check(in, out)).To(MatchError(
			`tools.yaml: no family matches a counted disclosure with the trailer key "assisted-by" (2 lines, #2, #3)`))
	})

	It("never quotes a candidate line in its error, which CI prints", func() {
		in.Records[2].Disclosure.Trailers = []string{
			"Co-developed-by: Claude Dupont <claude.dupont@example.com>",
			"Assisted-by: Jean Bard <jean.bard@example.com>",
		}
		in.Records[2].Disclosure.Description = []string{"Assisted by Marie Curie"}
		err := classify.Check(in, out)
		Expect(err).To(MatchError(And(
			ContainSubstring(`trailer key "co-developed-by"`),
			ContainSubstring(`trailer key "assisted-by"`),
			ContainSubstring("description or commit-prose"),
		)))
		for _, name := range []string{"Dupont", "Bard", "Curie", "example.com"} {
			Expect(err.Error()).NotTo(ContainSubstring(name))
		}
	})

	It("quotes the lines behind those problems in the report, every one whatever the top", func() {
		in.Top = 1
		in.Records[1].Disclosure.Trailers = []string{"Generated-by: Claude", "Made-by: Claude"}
		in.Records[2].Disclosure.Trailers = []string{"Generated-by: Claude", "Assisted-by: Bard"}
		in.Records[2].Disclosure.Description = []string{"Assisted by Bard"}
		Expect(classify.Check(in, out)).NotTo(Succeed())
		Expect(out.String()).To(ContainSubstring(`Trailers with an unlisted key and no ignore entry: 2
      2  Generated-by: Claude
      1  Made-by: Claude
Counted disclosures that match no family: 2
      1  Assisted by Bard
      1  Assisted-by: Bard
`))
	})

	It("lists every problem at once, and still reports", func() {
		in.Records[2].Disclosure.Trailers = []string{"Generated-by: Claude", "Assisted-by: Bard"}
		in.Meta = meta(1, 1)

		err := classify.Check(in, out)
		Expect(err).To(MatchError(And(
			ContainSubstring(`trailer key "generated-by"`),
			ContainSubstring(`trailer key "assisted-by"`),
			ContainSubstring(`opened in the window`),
		)))
		Expect(out.String()).To(ContainSubstring("Base branches: 2"))
	})
})

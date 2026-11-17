package extract_test

import (
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/jhoblitt/rook-dev-stats/internal/extract"
	"github.com/jhoblitt/rook-dev-stats/internal/fetch"
	"github.com/jhoblitt/rook-dev-stats/internal/record"
)

func fixture(name string) fetch.Entry {
	GinkgoHelper()
	b, err := os.ReadFile(filepath.Join("testdata", name+".json"))
	Expect(err).NotTo(HaveOccurred())
	var e fetch.Entry
	Expect(json.Unmarshal(b, &e)).To(Succeed(), "fixture %s", name)
	return e
}

// quiet is a logger for specs that do not read the log, which would
// otherwise go to the test binary's stderr.
func quiet() *slog.Logger {
	return slog.New(slog.DiscardHandler)
}

// entry is a minimal cached pull request by login, opened at created.
func entry(number int, login string, created time.Time) fetch.Entry {
	return fetch.Entry{
		Number: number, Title: "a pull request", State: "OPEN",
		CreatedAt: created, UpdatedAt: created, BaseRefName: "master",
		AuthorAssociation: "MEMBER",
		Author:            &fetch.Actor{Login: login, Typename: "User"},
		Labels:            []fetch.Label{}, Commits: []fetch.Commit{}, Comments: []fetch.Comment{},
		Reviews: []fetch.Review{}, TimelineItems: []fetch.Event{},
	}
}

var _ = Describe("FromEntry", func() {
	DescribeTable("gives the expected record",
		func(name string) {
			r, err := extract.FromEntry(fixture(name))
			Expect(err).NotTo(HaveOccurred())

			got, err := json.Marshal(r)
			Expect(err).NotTo(HaveOccurred())
			want, err := os.ReadFile(filepath.Join("testdata", name+".record.json"))
			Expect(err).NotTo(HaveOccurred())
			Expect(got).To(MatchJSON(want), "fixture %s", name)
		},
		Entry("a backport: cherry-picked commits authored months before, trailers above the Conflicts paragraph", "backport"),
		Entry("a draft later marked ready, back to draft and ready again", "draft-ready"),
		Entry("a PR closed, reopened, then merged, with reviews listed out of order", "reopened"),
		Entry("a PR force-pushed three times", "force-pushed"),
		Entry("a closed draft whose commits all postdate its opening, with offset commit times", "late-commits"),
		Entry("null authors on the PR, a comment and a review, cached before entries held names", "ghost"),
		Entry("a deleted account's backport, named by its committer, its comment and review by deleted accounts still ghost", "ghost-named"),
	)

	Describe("the author's name", func() {
		names := func() *fetch.CommitNames {
			return &fetch.CommitNames{Commits: []fetch.CommitName{{OID: "1", Author: "Kim Example", Committer: "Ivy Example"}}}
		}

		It("is given to no account but GitHub's ghost, whatever the entry holds", func() {
			e := entry(1, "alice", time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC))
			e.CommitNames = names()

			r, err := extract.FromEntry(e)

			Expect(err).NotTo(HaveOccurred())
			Expect(r.Author).To(Equal(record.Actor{Login: "alice"}))
		})

		DescribeTable("is left out for a deleted account's pull request",
			func(held *fetch.CommitNames) {
				e := entry(1, fetch.GhostLogin, time.Date(2016, 6, 1, 0, 0, 0, 0, time.UTC))
				e.CommitNames = held

				r, err := extract.FromEntry(e)

				Expect(err).NotTo(HaveOccurred())
				Expect(r.Author).To(Equal(record.Actor{Login: fetch.GhostLogin}))
				b, err := json.Marshal(r.Author)
				Expect(err).NotTo(HaveOccurred())
				Expect(b).To(MatchJSON(`{"login":"ghost","bot":false}`))
			},
			Entry("whose names were not read yet", (*fetch.CommitNames)(nil)),
			Entry("whose commits give no usable name",
				&fetch.CommitNames{Commits: []fetch.CommitName{{OID: "1", Committer: "GitHub", Author: " "}}}),
			Entry("with no commits returned", &fetch.CommitNames{Commits: []fetch.CommitName{}}),
		)

		It("is the name its commits credit, for the ghost the cache stores and for a null author alike", func() {
			for _, a := range []*fetch.Actor{nil, {Login: fetch.GhostLogin, Typename: "User"}} {
				e := entry(1, "x", time.Date(2016, 6, 1, 0, 0, 0, 0, time.UTC))
				e.Author = a
				e.CommitNames = names()

				r, err := extract.FromEntry(e)

				Expect(err).NotTo(HaveOccurred())
				Expect(r.Author).To(Equal(record.Actor{Login: fetch.GhostLogin, Name: "Ivy Example"}))
			}
		})
	})

	Describe("a comment's text", func() {
		text := func(body string) string {
			GinkgoHelper()
			e := entry(1, "alice", time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC))
			e.Comments = []fetch.Comment{{CreatedAt: e.CreatedAt, Body: body, Author: &fetch.Actor{Login: "bob", Typename: "User"}}}
			r, err := extract.FromEntry(e)
			Expect(err).NotTo(HaveOccurred())
			Expect(r.Comments).To(HaveLen(1))
			return r.Comments[0].Text
		}

		It("is kept for one line of 80 characters", func() {
			line := strings.Repeat("x", 80)
			Expect(text(line)).To(Equal(line))
		})

		It("is not kept for one line of 81 characters", func() {
			Expect(text(strings.Repeat("x", 81))).To(BeEmpty())
		})

		It("counts characters rather than bytes", func() {
			line := strings.Repeat("é", 80)
			Expect(text(line)).To(Equal(line))
		})

		It("is trimmed before it is measured", func() {
			Expect(text("  /retest \r\n")).To(Equal("/retest"))
			Expect(text(" " + strings.Repeat("x", 80) + "\n\n")).To(Equal(strings.Repeat("x", 80)))
		})

		It("is not kept for a comment of more than one line", func() {
			Expect(text("@mergifyio rebase\n/retest")).To(BeEmpty())
			Expect(text("@mergifyio rebase\r\n/retest")).To(BeEmpty())
		})

		DescribeTable("is not kept for a short line containing an @",
			func(body string) {
				Expect(text(body)).To(BeEmpty(), "comment %q", body)
			},
			Entry("a mention", "@alice can you take another look?"),
			Entry("a mention after a command", "@mergifyio rebase @alice"),
			Entry("an e-mail address", "Reviewed-by: Ana Smith <ana@example.com>"),
			Entry("an @ alone", "ping @"),
			Entry("a second @ after a command bot's mention", "@mergifyio backport release-1.21 @someone"),
			Entry("a leading mention of a person", "@someone please review"),
			Entry("an address in a sentence", "ping me at a@b.example"),
			Entry("a command bot's mention that is not leading", "thanks @dependabot"),
			Entry("a command bot's handle with no space after it", "@dependabot"),
			Entry("a longer handle that starts with a command bot's", "@dependabotx rebase"),
		)

		DescribeTable("is kept for a short line whose only @ is a leading mention of a command bot",
			func(body string) {
				Expect(text(body)).To(Equal(strings.TrimSpace(body)), "comment %q", body)
			},
			Entry("Mergify", "@mergifyio backport release-1.21"),
			Entry("Mergify, capitalised", "@Mergifyio rebase"),
			Entry("Mergify's other handle", "@mergify rebase"),
			Entry("Dependabot", "@dependabot rebase"),
			Entry("after leading whitespace", "  @dependabot rebase\n"),
		)

		It("is not kept for a command bot's mention over more than one line", func() {
			Expect(text("@mergifyio\nbackport release-1.21")).To(BeEmpty())
		})
	})

	It("truncates every time to the second in UTC", func() {
		e := entry(1, "alice", time.Date(2026, 6, 1, 12, 0, 0, 900_000_000, time.FixedZone("x", 3600)))

		r, err := extract.FromEntry(e)

		Expect(err).NotTo(HaveOccurred())
		Expect(r.Created).To(Equal(time.Date(2026, 6, 1, 11, 0, 0, 0, time.UTC)))
	})

	It("is an error naming the PR for a state it does not know", func() {
		e := entry(42, "alice", time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC))
		e.State = "LOCKED"

		_, err := extract.FromEntry(e)

		Expect(err).To(MatchError(`pull request 42: unknown state "LOCKED"`))
	})

	It("is an error naming the PR for an event it does not know", func() {
		e := entry(42, "alice", time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC))
		e.TimelineItems = []fetch.Event{{Typename: "LabeledEvent", CreatedAt: e.CreatedAt}}

		_, err := extract.FromEntry(e)

		Expect(err).To(MatchError(`pull request 42: unknown event "LabeledEvent"`))
	})
})

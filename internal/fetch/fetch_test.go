package fetch_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/onsi/gomega/types"

	"github.com/jhoblitt/rook-dev-stats/internal/fetch"
	"github.com/jhoblitt/rook-dev-stats/internal/fetch/fetchtest"
	"github.com/jhoblitt/rook-dev-stats/internal/ghapi"
	"github.com/jhoblitt/rook-dev-stats/internal/record"
)

const token = "ghp_spec-token-never-written"

var (
	base      = time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	walkStart = time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC)
	// created is the repository's createdAt in the counts specs: later in
	// the day than the default window start.
	created = time.Date(2016, 7, 8, 17, 30, 0, 0, time.UTC)
)

func at(hours int) time.Time { return base.Add(time.Duration(hours) * time.Hour) }

func user(login string) *fetch.Actor { return &fetch.Actor{Login: login, Typename: "User"} }

func pr(number, updated int, state string) fetch.Entry {
	e := fetch.Entry{
		Number: number, Title: "pr " + strconv.Itoa(number), Body: "body", State: state,
		CreatedAt: at(-100), UpdatedAt: at(updated), BaseRefName: "main",
		Additions: 3, Deletions: 1, ChangedFiles: 2, AuthorAssociation: "MEMBER",
		Author: user("alice"),
	}
	if state != "OPEN" {
		e.ClosedAt = new(at(updated))
	}
	return e
}

// sha is a commit id that tells commit i apart.
func sha(i int) string { return fmt.Sprintf("%040x", 0xc0ffee00+i) }

func commits(n int) []fetch.Commit {
	out := make([]fetch.Commit, n)
	for i := range out {
		out[i] = fetch.Commit{OID: sha(i), AuthoredDate: at(-90 + i), CommittedDate: at(-80 + i), Message: fmt.Sprintf("commit %d", i)}
	}
	return out
}

func comments(n int) []fetch.Comment {
	out := make([]fetch.Comment, n)
	for i := range out {
		out[i] = fetch.Comment{DatabaseID: 4854682435 + int64(i), CreatedAt: at(-70 + i), Body: fmt.Sprintf("comment %d", i), Author: user("bob")}
	}
	return out
}

func reviews(n int) []fetch.Review {
	out := make([]fetch.Review, n)
	for i := range out {
		out[i] = fetch.Review{DatabaseID: 3954682435 + int64(i), SubmittedAt: new(at(-60 + i)), State: "COMMENTED", Author: user("carol")}
	}
	return out
}

var _ = Describe("Run", func() {
	var (
		cacheDir string
		server   *fetchtest.Server
		pageSize int
		waits    []int
		logs     *bytes.Buffer
		// defaultSince marks run's since as the default, not the operator's.
		defaultSince bool
		// defaultSinceAt is run's Config.DefaultSince.
		defaultSinceAt time.Time
		// window is run's Config.WindowStart; zero takes the default.
		window time.Time
		// refetch is run's Config.Refetch.
		refetch bool
	)

	BeforeEach(func() {
		cacheDir = GinkgoT().TempDir()
		pageSize = 0
		waits = nil
		logs = &bytes.Buffer{}
		defaultSince = false
		defaultSinceAt = time.Time{}
		window = time.Date(2026, 5, 15, 0, 0, 0, 0, time.UTC)
		refetch = false
	})

	serve := func(prs ...fetch.Entry) {
		server = fetchtest.NewServer(prs...)
		DeferCleanup(server.Close)
	}

	run := func(since time.Time) error {
		logger := slog.New(slog.NewJSONHandler(logs, &slog.HandlerOptions{Level: slog.LevelDebug}))
		client, err := ghapi.NewClient(server.URL, token,
			ghapi.WithHTTPClient(server.Client()),
			ghapi.WithLogger(logger),
			ghapi.WithBackoff(func(_ context.Context, attempt int) error {
				waits = append(waits, attempt)
				return nil
			}))
		Expect(err).NotTo(HaveOccurred())
		return fetch.Run(context.Background(), client, fetch.Config{
			CacheDir:       cacheDir,
			WindowStart:    window,
			Since:          since,
			SinceIsDefault: defaultSince,
			DefaultSince:   defaultSinceAt,
			Refetch:        refetch,
			PageSize:       pageSize,
			NestedPageSize: 2,
			Logger:         logger,
			Now:            func() time.Time { return walkStart },
		})
	}

	entry := func(number int) fetch.Entry {
		e, err := fetch.ReadEntry(cacheDir, number)
		Expect(err).NotTo(HaveOccurred(), "entry %d", number)
		return e
	}

	rawFiles := func() []string {
		des, err := os.ReadDir(filepath.Join(cacheDir, "raw"))
		Expect(err).NotTo(HaveOccurred())
		var names []string
		for _, de := range des {
			names = append(names, de.Name())
		}
		return names
	}

	// listed returns the page sizes of the PullRequests requests whose
	// states variable is (open) or is not (!open) set.
	listed := func(open bool) []int {
		var firsts []int
		for _, r := range server.Operations(ghapi.PullRequests.Name) {
			if _, ok := r.Variables["states"]; ok == open {
				firsts = append(firsts, r.Int("first"))
			}
		}
		return firsts
	}

	// searched returns the search of each request that asked GitHub's
	// search for the window's count, in order.
	searched := func() []string {
		var out []string
		for _, r := range server.Requests() {
			if s, ok := r.Variables["search"].(string); ok {
				out = append(out, s)
			}
		}
		return out
	}

	// logged returns the log records with message msg.
	logged := func(msg string) []map[string]any {
		GinkgoHelper()
		var out []map[string]any
		for line := range bytes.Lines(logs.Bytes()) {
			var m map[string]any
			Expect(json.Unmarshal(line, &m)).To(Succeed(), "log line %s", line)
			if m["msg"] == msg {
				out = append(out, m)
			}
		}
		return out
	}

	nestedFor := func(c ghapi.Connection, number int) []string {
		var afters []string
		for _, r := range server.Operations(ghapi.ConnectionPage(c).Name) {
			if r.Int("number") == number {
				afters = append(afters, r.String("after"))
			}
		}
		return afters
	}

	It("caches a PR with every page of its commits, comments and reviews, in order", func() {
		want := pr(1, 5, "MERGED")
		want.MergedAt = new(at(5))
		want.Labels = []fetch.Label{{Name: "rgw"}, {Name: "tests"}, {Name: "backport"}}
		want.ClosingIssues = []fetch.ClosingIssue{
			{Number: 40, Repository: "rook/rook", Labels: []fetch.Label{{Name: "bug"}, {Name: "csi"}}},
			{Number: 39, Repository: "ceph/ceph-csi", Labels: []fetch.Label{}},
		}
		want.Commits = commits(6)
		want.Comments = comments(3)
		want.Reviews = reviews(4)
		want.TimelineItems = []fetch.Event{
			{Typename: "ReadyForReviewEvent", CreatedAt: at(-50)},
			{Typename: "MergedEvent", CreatedAt: at(5)},
		}
		serve(want)

		Expect(run(fetch.WindowStart)).To(Succeed())

		want.FetchedAt = walkStart
		want.FormatVersion = fetch.FormatVersion
		Expect(entry(1)).To(Equal(want))
		Expect(nestedFor(ghapi.Commits, 1)).To(Equal([]string{"o2", "o4"}))
		Expect(nestedFor(ghapi.Comments, 1)).To(Equal([]string{"o2"}))
		Expect(nestedFor(ghapi.Reviews, 1)).To(Equal([]string{"o2"}))
		Expect(nestedFor(ghapi.Labels, 1)).To(Equal([]string{"o2"}))
		Expect(nestedFor(ghapi.TimelineItems, 1)).To(BeEmpty())
	})

	It("stores a null author as ghost", func() {
		p := pr(2, 5, "CLOSED")
		p.Author = nil
		p.Comments = []fetch.Comment{{CreatedAt: at(1), Body: "hi"}}
		p.Reviews = []fetch.Review{{SubmittedAt: new(at(2)), State: "APPROVED"}}
		serve(p)

		Expect(run(fetch.WindowStart)).To(Succeed())

		ghost := &fetch.Actor{Login: "ghost", Typename: "User"}
		e := entry(2)
		Expect(e.Author).To(Equal(ghost))
		Expect(e.Comments[0].Author).To(Equal(ghost))
		Expect(e.Reviews[0].Author).To(Equal(ghost))
	})

	isRateLimit := func(err error) bool {
		rl, ok := errors.AsType[*ghapi.RateLimitError](err)
		return ok && rl.Reset.Equal(time.Date(2026, 11, 15, 13, 0, 0, 0, time.UTC))
	}
	rateLimited := func() *fetchtest.Reply {
		return &fetchtest.Reply{Status: 403, Header: map[string]string{
			"x-ratelimit-remaining": "0", "x-ratelimit-reset": "1794747600",
		}}
	}

	// namesOf returns the pull request numbers each CommitNames request
	// asked for, in order.
	namesOf := func() [][]int {
		var out [][]int
		for _, r := range server.Operations(ghapi.CommitNames(0).Name) {
			var numbers []int
			for i := 0; r.Int("n"+strconv.Itoa(i)) >= 0; i++ {
				numbers = append(numbers, r.Int("n"+strconv.Itoa(i)))
			}
			out = append(out, numbers)
		}
		return out
	}

	It("asks for the commits' names of a PR opened by a deleted account, every page of them, and caches only the names", func() {
		p := pr(2, 5, "CLOSED")
		p.Author = nil
		p.Commits = commits(5)
		p.CommitNames = signed(
			[2]string{"Ana Example", "Ben Example"}, [2]string{"GitHub", "Ana Example"}, [2]string{"Ana Example", "Cy Example"},
			[2]string{"Ana Example", "Ben Example"}, [2]string{"Dee Example", "Dee Example"},
		)
		serve(p)

		Expect(run(fetch.WindowStart)).To(Succeed())

		asked := server.Operations(ghapi.CommitNames(0).Name)
		Expect(asked).To(HaveLen(1))
		Expect(asked[0].Variables).To(Equal(map[string]any{"owner": "rook", "name": "rook", "first": 2.0, "n0": 2.0}))
		var afters []string
		for _, r := range server.Operations(ghapi.CommitNamesPage.Name) {
			Expect(r.Int("number")).To(Equal(2))
			afters = append(afters, r.String("after"))
		}
		Expect(afters).To(Equal([]string{"o2", "o4"}))
		Expect(entry(2).CommitNames).To(Equal(p.CommitNames))
		Expect(entry(2).Author).To(Equal(&fetch.Actor{Login: "ghost", Typename: "User"}))
		Expect(logged("named deleted accounts' pull requests")).To(HaveExactElements(And(
			HaveKeyWithValue("deleted", 1.0),
			HaveKeyWithValue("completed", 0.0),
			HaveKeyWithValue("without_name", 0.0),
		)), "the walk named it, leaving the completion nothing to ask; log:\n%s", logs.String())
	})

	It("caches each name cleaned, and no name that holds an @, so that no address reaches the cache", func() {
		p := pr(2, 5, "CLOSED")
		p.Author = nil
		p.Commits = commits(3)
		p.CommitNames = signed(
			[2]string{"ana@example.com", "Ana Example <ana@example.com>"},
			[2]string{"Ben Example (ben@example.com)", "\u202eIvy\u200d \t Example\x07 "},
			[2]string{"GitHub", "Cy Example"},
		)
		serve(p)

		Expect(run(fetch.WindowStart)).To(Succeed())

		Expect(entry(2).CommitNames).To(Equal(&fetch.CommitNames{Commits: []fetch.CommitName{
			{OID: sha(0), Author: "", Committer: ""},
			{OID: sha(1), Author: "Ivy Example", Committer: ""},
			{OID: sha(2), Author: "Cy Example", Committer: "GitHub"},
		}}))
		b, err := os.ReadFile(filepath.Join(cacheDir, "raw", "2.json"))
		Expect(err).NotTo(HaveOccurred())
		Expect(string(b)).NotTo(ContainSubstring("@"))
	})

	It("never asks for the names of a PR whose author's account is live, and caches none", func() {
		p := pr(1, 5, "CLOSED")
		p.Commits = commits(3)
		p.CommitNames = signed([2]string{"Ana Example", "Ana Example"}, [2]string{"Ana Example", "Ana Example"}, [2]string{"Ana Example", "Ana Example"})
		serve(p)

		Expect(run(fetch.WindowStart)).To(Succeed())

		Expect(server.Operations(ghapi.CommitNames(0).Name)).To(BeEmpty())
		Expect(server.Operations(ghapi.CommitNamesPage.Name)).To(BeEmpty())
		Expect(entry(1).CommitNames).To(BeNil())
		Expect(readJSON(filepath.Join(cacheDir, "raw", "1.json"))).NotTo(HaveKey("commitNames"))
	})

	It("saves no entry for a deleted account's PR whose names it cannot have", func() {
		p := pr(2, 2, "CLOSED")
		p.Author = nil
		serve(pr(9, 9, "CLOSED"), p)
		server.Intercept(func(_ int, r fetchtest.Request) *fetchtest.Reply {
			if r.Operation == ghapi.CommitNames(0).Name {
				return rateLimited()
			}
			return nil
		})

		Expect(run(fetch.WindowStart)).To(MatchError(isRateLimit, "a *ghapi.RateLimitError"))

		Expect(rawFiles()).To(ConsistOf("9.json"))
		Expect(filepath.Join(cacheDir, fetch.MetaFile)).NotTo(BeAnExistingFile())
	})

	Describe("completing a cache written before entries held names", func() {
		const oldMeta = `{"window_start":"2026-05-15T00:00:00Z","walk_started":"2026-11-14T00:00:00Z","opened_in_window":30,"opened_in_window_source":"search","open":0}` + "\n"
		metaPath := func() string { return filepath.Join(cacheDir, fetch.MetaFile) }
		rawPath := func(number int) string { return filepath.Join(cacheDir, "raw", strconv.Itoa(number)+".json") }
		raw := func(number int) string {
			GinkgoHelper()
			b, err := os.ReadFile(rawPath(number))
			Expect(err).NotTo(HaveOccurred())
			return string(b)
		}

		// deleted is pull request number as GitHub holds it: opened by a
		// deleted account, its one commit committed by committer.
		deleted := func(number int, committer string) fetch.Entry {
			p := pr(number, 1, "CLOSED")
			p.Author = nil
			p.Commits = commits(1)
			p.CommitNames = signed([2]string{committer, "Ben Example"})
			return p
		}
		// cacheAsBefore writes each of prs as a fetch from before entries
		// held names cached it.
		cacheAsBefore := func(prs ...fetch.Entry) {
			GinkgoHelper()
			Expect(os.MkdirAll(filepath.Join(cacheDir, "raw"), 0o750)).To(Succeed())
			for _, p := range prs {
				if p.Author == nil {
					p.Author = &fetch.Actor{Login: fetch.GhostLogin, Typename: "User"}
				}
				p.CommitNames = nil
				p.FetchedAt = time.Date(2026, 11, 14, 0, 0, 0, 0, time.UTC)
				p.FormatVersion = fetch.FormatVersion
				b, err := json.MarshalIndent(p, "", "  ")
				Expect(err).NotTo(HaveOccurred())
				Expect(os.WriteFile(rawPath(p.Number), append(b, '\n'), 0o600)).To(Succeed())
			}
		}

		var (
			held []fetch.Entry
			// before is each cached entry's bytes before the run.
			before map[int]string
		)

		BeforeEach(func() {
			held = nil
			for n := 1; n <= 27; n++ {
				held = append(held, deleted(n, fmt.Sprintf("Name %02d Example", n)))
			}
			held[26].CommitNames = signed([2]string{"GitHub", ""})
			live := pr(40, 1, "CLOSED")
			live.Commits = commits(1)
			live.CommitNames = signed([2]string{"Ana Example", "Ana Example"})
			named := deleted(30, "Cy Example")
			held = append(held, live, named)
			serve(held...)
			cacheAsBefore(held...)
			e := readJSON(rawPath(30))
			e["commitNames"] = named.CommitNames
			b, err := json.MarshalIndent(e, "", "  ")
			Expect(err).NotTo(HaveOccurred())
			Expect(os.WriteFile(rawPath(30), append(b, '\n'), 0o600)).To(Succeed())
			Expect(os.WriteFile(metaPath(), []byte(oldMeta), 0o600)).To(Succeed())
			before = map[int]string{}
			for _, p := range held {
				before[p.Number] = raw(p.Number)
			}
		})

		// complete reports whether entry number is as it was before the run
		// but for the names GitHub holds for it.
		complete := func(number int) bool {
			GinkgoHelper()
			got := entry(number)
			i := slices.IndexFunc(held, func(p fetch.Entry) bool { return p.Number == number })
			Expect(got.CommitNames).To(Equal(held[i].CommitNames), "PR %d's names", number)
			got.CommitNames = nil
			var was fetch.Entry
			Expect(json.Unmarshal([]byte(before[number]), &was)).To(Succeed())
			Expect(got).To(Equal(was), "PR %d but for its names", number)
			return true
		}

		It("names every deleted account's entry, 25 PRs a request, though the walk stores nothing, marks the cache, and logs the counts but no name", func() {
			Expect(run(at(100))).To(Succeed())

			Expect(logged("reached since")).To(ContainElement(HaveKeyWithValue("fetched", 0.0)))
			Expect(rawFiles()).To(HaveLen(29))
			var want []int
			for n := 1; n <= 27; n++ {
				want = append(want, n)
				Expect(complete(n)).To(BeTrue())
			}
			Expect(namesOf()).To(Equal([][]int{want[:25], want[25:]}))
			Expect(raw(40)).To(Equal(before[40]), "the live author's entry")
			Expect(raw(30)).To(Equal(before[30]), "the entry that held names already")
			Expect(readJSON(metaPath())).To(HaveKeyWithValue("deleted_authors_named", true))
			Expect(logged("named deleted accounts' pull requests")).To(HaveExactElements(And(
				HaveKeyWithValue("level", "INFO"),
				HaveKeyWithValue("deleted", 28.0),
				HaveKeyWithValue("completed", 27.0),
				HaveKeyWithValue("without_name", 1.0),
			)), "log:\n%s", logs.String())
			Expect(logs.String()).NotTo(ContainSubstring("Example"))
		})

		It("leaves each entry as it was or complete when a request fails part-way, writes no mark, and completes the rest next time", func() {
			server.Intercept(func(_ int, r fetchtest.Request) *fetchtest.Reply {
				if r.Operation == ghapi.CommitNames(0).Name && len(server.Operations(r.Operation)) == 2 {
					return rateLimited()
				}
				return nil
			})

			Expect(run(at(100))).To(MatchError(isRateLimit, "a *ghapi.RateLimitError"))

			for n := 1; n <= 25; n++ {
				Expect(complete(n)).To(BeTrue())
			}
			Expect(raw(26)).To(Equal(before[26]))
			Expect(raw(27)).To(Equal(before[27]))
			Expect(os.ReadFile(metaPath())).To(Equal([]byte(oldMeta)))

			server.Intercept(nil)
			Expect(run(at(100))).To(Succeed())

			asked := namesOf()
			Expect(asked[len(asked)-1]).To(Equal([]int{26, 27}), "the second run asks only for the two left")
			Expect(complete(26)).To(BeTrue())
			Expect(complete(27)).To(BeTrue())
			Expect(readJSON(metaPath())).To(HaveKeyWithValue("deleted_authors_named", true))
		})

		It("rewrites no entry of a batch when a further page of one of its PRs fails", func() {
			server.Update(2, func(e *fetch.Entry) {
				e.Commits = commits(3)
				e.CommitNames = signed([2]string{"Ana Example", "x"}, [2]string{"Ana Example", "x"}, [2]string{"Ana Example", "x"})
			})
			server.Intercept(func(_ int, r fetchtest.Request) *fetchtest.Reply {
				if r.Operation == ghapi.CommitNamesPage.Name {
					return &fetchtest.Reply{Status: 503}
				}
				return nil
			})

			err := run(at(100))

			Expect(err).To(And(MatchError(ghapi.ErrUnavailable), MatchError(ContainSubstring("pull request 2"))))
			for _, p := range held {
				Expect(raw(p.Number)).To(Equal(before[p.Number]), "PR %d", p.Number)
			}
			Expect(os.ReadFile(metaPath())).To(Equal([]byte(oldMeta)))
		})

		It("is an error naming the PR, rewriting nothing, when the reply leaves one out", func() {
			server.Intercept(func(_ int, r fetchtest.Request) *fetchtest.Reply {
				if r.Operation == ghapi.CommitNames(0).Name {
					return &fetchtest.Reply{Status: 200, Body: `{"data":{"repository":{"p0":{"commits":{"pageInfo":{"hasNextPage":false},"nodes":[]}},"p1":null}}}`}
				}
				return nil
			})

			err := run(at(100))

			Expect(err).To(MatchError(And(ContainSubstring("pull request 2"), ContainSubstring("commits"))))
			Expect(err).NotTo(MatchError(ghapi.ErrUnavailable))
			for _, p := range held {
				Expect(raw(p.Number)).To(Equal(before[p.Number]), "PR %d", p.Number)
			}
		})

		It("leaves as it was each entry whose PR GitHub can no longer resolve, warning once for each, names the rest, marks the cache, and counts them as the run ends", func() {
			server.Update(2, func(e *fetch.Entry) {
				e.Commits = commits(3)
				e.CommitNames = signed([2]string{"Ana Example", "x"}, [2]string{"Ana Example", "x"}, [2]string{"Ana Example", "x"})
			})
			server.Delete(5)
			server.After(func(_ int, r fetchtest.Request) {
				if r.Operation == ghapi.CommitNames(0).Name && len(server.Operations(r.Operation)) == 1 {
					server.Delete(2)
				}
			})

			Expect(run(at(100))).To(Succeed())

			var want []int
			for n := 1; n <= 27; n++ {
				want = append(want, n)
				if n != 2 && n != 5 {
					Expect(complete(n)).To(BeTrue())
				}
			}
			Expect(namesOf()).To(Equal([][]int{want[:25], want[25:]}))
			Expect(raw(2)).To(Equal(before[2]), "PR 2, gone before its further page of names")
			Expect(raw(5)).To(Equal(before[5]), "PR 5, gone before the pass")
			Expect(logged("skipping a pull request github cannot resolve")).To(ConsistOf(
				And(HaveKeyWithValue("level", "WARN"), HaveKeyWithValue("number", 2.0)),
				And(HaveKeyWithValue("level", "WARN"), HaveKeyWithValue("number", 5.0)),
			), "log:\n%s", logs.String())
			Expect(logged("named deleted accounts' pull requests")).To(HaveExactElements(And(
				HaveKeyWithValue("deleted", 28.0),
				HaveKeyWithValue("completed", 25.0),
				HaveKeyWithValue("unresolved", 2.0),
				HaveKeyWithValue("without_name", 1.0),
			)), "log:\n%s", logs.String())
			Expect(logged("walk finished")).To(HaveExactElements(HaveKeyWithValue("unresolved", 2.0)))
			Expect(readJSON(metaPath())).To(HaveKeyWithValue("deleted_authors_named", true))
		})

		It("warns and counts once a PR the walk and then the names pass both find GitHub can no longer resolve", func() {
			server.Update(3, func(e *fetch.Entry) { e.UpdatedAt = at(200) })
			server.After(func(n int, _ fetchtest.Request) {
				if n == 0 {
					server.Delete(3)
				}
			})

			Expect(run(at(100))).To(Succeed())

			Expect(raw(3)).To(Equal(before[3]))
			Expect(logged("skipping a pull request github cannot resolve")).To(HaveExactElements(HaveKeyWithValue("number", 3.0)),
				"log:\n%s", logs.String())
			Expect(logged("named deleted accounts' pull requests")).To(HaveExactElements(HaveKeyWithValue("unresolved", 1.0)))
			Expect(logged("walk finished")).To(HaveExactElements(HaveKeyWithValue("unresolved", 1.0)))
		})

		It("is an error, rewriting nothing, when GitHub cannot resolve the repository the names are asked of", func() {
			server.Intercept(func(_ int, r fetchtest.Request) *fetchtest.Reply {
				if r.Operation == ghapi.CommitNames(0).Name {
					return &fetchtest.Reply{Status: 200, Body: `{"data":{"repository":null},"errors":[{"type":"NOT_FOUND","path":["repository"],"message":"Could not resolve to a Repository with the name 'rook/rook'."}]}`}
				}
				return nil
			})

			Expect(run(at(100))).To(MatchError(ContainSubstring("Could not resolve to a Repository")))

			for _, p := range held {
				Expect(raw(p.Number)).To(Equal(before[p.Number]), "PR %d", p.Number)
			}
			Expect(os.ReadFile(metaPath())).To(Equal([]byte(oldMeta)))
		})

		It("does no pass and asks nothing once meta.json records the cache complete", func() {
			Expect(os.WriteFile(metaPath(), []byte(strings.Replace(oldMeta, `"open":0}`, `"open":0,"deleted_authors_named":true}`, 1)), 0o600)).To(Succeed())

			Expect(run(at(100))).To(Succeed())

			Expect(server.Operations(ghapi.CommitNames(0).Name)).To(BeEmpty())
			Expect(logged("named deleted accounts' pull requests")).To(BeEmpty())
			for _, p := range held {
				Expect(raw(p.Number)).To(Equal(before[p.Number]), "PR %d", p.Number)
			}
			Expect(readJSON(metaPath())).To(HaveKeyWithValue("deleted_authors_named", true))
		})

		It("names the entries but leaves meta.json as it was when the walk does not advance the coverage mark, and the next run asks nothing", func() {
			defaultSinceAt = at(5)

			Expect(run(at(100))).To(Succeed())

			Expect(complete(1)).To(BeTrue())
			Expect(os.ReadFile(metaPath())).To(Equal([]byte(oldMeta)))
			requests := len(server.Operations(ghapi.CommitNames(0).Name))
			logs.Reset()

			Expect(run(at(100))).To(Succeed())

			Expect(server.Operations(ghapi.CommitNames(0).Name)).To(HaveLen(requests))
			Expect(logged("named deleted accounts' pull requests")).To(HaveExactElements(HaveKeyWithValue("completed", 0.0)))
		})
	})

	// serveLinksPage answers the walk's first list request with the page in
	// testdata/links-page.json, after edit.
	serveLinksPage := func(edit func(string) string) {
		GinkgoHelper()
		page, err := os.ReadFile(filepath.Join("testdata", "links-page.json"))
		Expect(err).NotTo(HaveOccurred())
		body := edit(string(page))
		serve()
		server.Intercept(func(_ int, r fetchtest.Request) *fetchtest.Reply {
			if _, open := r.Variables["states"]; r.Operation == ghapi.PullRequests.Name && !open {
				return &fetchtest.Reply{Status: 200, Body: body}
			}
			return nil
		})
	}

	It("is an error naming the PR when a fullDatabaseId is not a number, and does not retry it", func() {
		serveLinksPage(func(s string) string {
			return strings.Replace(s, `"fullDatabaseId": "4854682435"`, `"fullDatabaseId": "48x"`, 1)
		})

		err := run(fetch.WindowStart)

		Expect(err).To(MatchError(And(ContainSubstring("pull request 69877"), ContainSubstring(`"48x"`))))
		Expect(err).NotTo(MatchError(ghapi.ErrUnavailable))
		Expect(server.Operations(ghapi.PullRequests.Name)).To(HaveLen(1))
	})

	It("caches no id for a comment whose fullDatabaseId is null", func() {
		serveLinksPage(func(s string) string {
			return strings.Replace(s, `"fullDatabaseId": "4854682435"`, `"fullDatabaseId": null`, 1)
		})

		Expect(run(fetch.WindowStart)).To(Succeed())

		Expect(entry(69877).Comments).To(HaveExactElements(HaveField("DatabaseID", BeZero())))
	})

	It("caches the closing issues, each with its repository and labels, in GitHub's order, without paging them", func() {
		serveLinksPage(func(s string) string { return s })

		Expect(run(fetch.WindowStart)).To(Succeed())

		Expect(entry(69877).ClosingIssues).To(Equal([]fetch.ClosingIssue{
			{Number: 16712, Repository: "rook/rook", Labels: []fetch.Label{{Name: "bug"}, {Name: "csi"}}},
			{Number: 5120, Repository: "ceph/ceph-csi", Labels: []fetch.Label{}},
		}))
		Expect(readJSON(filepath.Join(cacheDir, "raw", "69877.json"))).To(HaveKeyWithValue("closingIssuesReferences", HaveExactElements(
			Equal(map[string]any{
				"number": 16712.0, "repository": "rook/rook",
				"labels": []any{map[string]any{"name": "bug"}, map[string]any{"name": "csi"}},
			}),
			Equal(map[string]any{"number": 5120.0, "repository": "ceph/ceph-csi", "labels": []any{}}),
		)))
		Expect(server.Requests()).To(HaveEach(HaveField("Operation", Not(ContainSubstring("ClosingIssues")))),
			"no further page is asked for")
	})

	DescribeTable("caches no closing issues for a listed PR whose reply lacks them, and walks on",
		func(closing string) {
			serveLinksPage(func(s string) string {
				before, rest, _ := strings.Cut(s, `"closingIssuesReferences": {`)
				_, after, _ := strings.Cut(rest, `"commits": {`)
				return before + closing + `"commits": {` + after
			})

			Expect(run(fetch.WindowStart)).To(Succeed())

			Expect(entry(69877).ClosingIssues).To(BeEmpty())
			Expect(readJSON(filepath.Join(cacheDir, "raw", "69877.json"))).To(HaveKeyWithValue("closingIssuesReferences", Equal([]any{})))
			Expect(filepath.Join(cacheDir, fetch.MetaFile)).To(BeAnExistingFile(), "the walk finished")
		},
		Entry("missing", ``),
		Entry("null", `"closingIssuesReferences": null,
            `),
	)

	It("caches the ids, addresses and SHAs that links to GitHub are built from, under GitHub's names", func() {
		serveLinksPage(func(s string) string { return s })

		Expect(run(fetch.WindowStart)).To(Succeed())

		ts := func(s string) time.Time {
			GinkgoHelper()
			t, err := time.Parse(time.RFC3339, s)
			Expect(err).NotTo(HaveOccurred())
			return t
		}
		ref := func(oid string) *fetch.CommitRef { return &fetch.CommitRef{OID: oid} }
		const addr = "https://github.com/ceph/ceph/pull/69877#event-"
		e := entry(69877)
		Expect(e.FormatVersion).To(Equal(fetch.FormatVersion))
		Expect(e.Commits).To(HaveExactElements(
			HaveField("OID", "3f9a1c0d2b4e6f8a0c1e3d5b7f9a1c3e5d7b9f1a"),
			HaveField("OID", "8b2d4f6a8c0e2a4c6e8a0c2e4a6c8e0a2c4e6a8c"),
		))
		Expect(e.Comments).To(HaveExactElements(HaveField("DatabaseID", int64(4854682435))))
		Expect(e.Reviews).To(HaveExactElements(HaveField("DatabaseID", int64(3412345678))))
		Expect(e.TimelineItems).To(Equal([]fetch.Event{
			{Typename: "ReadyForReviewEvent", CreatedAt: ts("2026-10-28T20:00:00Z"), URL: addr + "28644873432"},
			{
				Typename: "HeadRefForcePushedEvent", CreatedAt: ts("2026-10-29T18:00:00Z"),
				BeforeCommit: ref("1111111111111111111111111111111111111111"),
				AfterCommit:  ref("8b2d4f6a8c0e2a4c6e8a0c2e4a6c8e0a2c4e6a8c"),
			},
			{Typename: "HeadRefForcePushedEvent", CreatedAt: ts("2026-10-29T19:00:00Z")},
			{Typename: "ClosedEvent", CreatedAt: ts("2026-10-30T01:00:00Z"), URL: addr + "28644900001"},
			{Typename: "ReopenedEvent", CreatedAt: ts("2026-10-30T02:00:00Z")},
			{Typename: "ConvertToDraftEvent", CreatedAt: ts("2026-10-30T03:00:00Z"), URL: addr + "28644900002"},
			{
				Typename: "MergedEvent", CreatedAt: ts("2026-11-01T05:00:00Z"), URL: addr + "28644900003",
				Commit: ref("c0ffee0000000000000000000000000000000001"),
			},
			{Typename: "ClosedEvent", CreatedAt: ts("2026-11-01T05:00:00Z"), URL: addr + "28644900004"},
		}))
		raw := readJSON(filepath.Join(cacheDir, "raw", "69877.json"))
		Expect(raw).To(HaveKeyWithValue("formatVersion", float64(fetch.FormatVersion)))
		Expect(raw).To(HaveKeyWithValue("comments", HaveExactElements(HaveKeyWithValue("fullDatabaseId", "4854682435"))),
			"the cache keeps GitHub's BigInt as a string")
		Expect(raw).To(HaveKeyWithValue("reviews", HaveExactElements(HaveKeyWithValue("fullDatabaseId", "3412345678"))))
	})

	It("fetches again an entry of an older format though its updatedAt is unchanged, and not one of the current format", func() {
		unversioned := pr(3, 3, "CLOSED")
		unversioned.Comments = comments(3)
		older := pr(4, 4, "CLOSED")
		older.Comments = comments(3)
		serve(unversioned, older)
		Expect(run(fetch.WindowStart)).To(Succeed())
		rewrite := func(number int, f func(map[string]any)) {
			GinkgoHelper()
			path := filepath.Join(cacheDir, "raw", strconv.Itoa(number)+".json")
			e := readJSON(path)
			f(e)
			b, err := json.Marshal(e)
			Expect(err).NotTo(HaveOccurred())
			Expect(os.WriteFile(path, b, 0o600)).To(Succeed())
		}
		rewrite(3, func(e map[string]any) { delete(e, "formatVersion") })
		rewrite(4, func(e map[string]any) { e["formatVersion"] = fetch.FormatVersion - 1 })

		Expect(run(fetch.WindowStart)).To(Succeed())

		Expect(nestedFor(ghapi.Comments, 3)).To(HaveLen(2), "PR 3, without a version, is fetched by both runs")
		Expect(nestedFor(ghapi.Comments, 4)).To(HaveLen(2), "PR 4, of an older version, is fetched by both runs")
		Expect(entry(3).FormatVersion).To(Equal(fetch.FormatVersion))
		Expect(entry(4).FormatVersion).To(Equal(fetch.FormatVersion))

		Expect(run(fetch.WindowStart)).To(Succeed())

		Expect(nestedFor(ghapi.Comments, 3)).To(HaveLen(2), "PR 3, now current, is not fetched by a third run")
		Expect(nestedFor(ghapi.Comments, 4)).To(HaveLen(2), "PR 4, now current, is not fetched by a third run")
	})

	Context("when the cache holds an entry of an older format that the since would not reach", func() {
		var since time.Time

		BeforeEach(func() {
			since = at(5)
			old, recent := pr(1, 1, "CLOSED"), pr(9, 9, "CLOSED")
			old.Comments, recent.Comments = comments(3), comments(3)
			serve(old, recent)
			Expect(run(fetch.WindowStart)).To(Succeed())
			path := filepath.Join(cacheDir, "raw", "1.json")
			e := readJSON(path)
			delete(e, "formatVersion")
			b, err := json.Marshal(e)
			Expect(err).NotTo(HaveOccurred())
			Expect(os.WriteFile(path, b, 0o600)).To(Succeed())
			logs.Reset()
		})

		It("walks back to the window start from a default since, refetching it, and warns once why", func() {
			defaultSince = true

			Expect(run(since)).To(Succeed())

			Expect(nestedFor(ghapi.Comments, 1)).To(HaveLen(2), "PR 1 is fetched again")
			Expect(entry(1).FormatVersion).To(Equal(fetch.FormatVersion))
			Expect(logged("cache holds entries of an older format")).To(HaveExactElements(And(
				HaveKeyWithValue("level", "WARN"),
				HaveKeyWithValue("entries", 1.0),
				HaveKeyWithValue("since", "2026-05-15T00:00:00Z"),
			)), "log:\n%s", logs.String())
		})

		It("walks from an explicit since as given, with the same warning", func() {
			Expect(run(since)).To(Succeed())

			Expect(nestedFor(ghapi.Comments, 1)).To(HaveLen(1), "PR 1 is not reached")
			Expect(entry(1).FormatVersion).To(BeZero())
			Expect(logged("cache holds entries of an older format")).To(HaveExactElements(And(
				HaveKeyWithValue("level", "WARN"),
				HaveKeyWithValue("entries", 1.0),
				HaveKeyWithValue("since", "2026-11-01T05:00:00Z"),
			)), "log:\n%s", logs.String())
		})

		It("walks from a default since as before once every entry is current", func() {
			defaultSince = true
			Expect(run(since)).To(Succeed())
			logs.Reset()

			Expect(run(since)).To(Succeed())

			Expect(logged("cache holds entries of an older format")).To(BeEmpty())
			Expect(logged("reached since")).To(ContainElement(HaveKeyWithValue("phase", "updated")),
				"the walk stops at the default since, before PR 1; log:\n%s", logs.String())
			Expect(nestedFor(ghapi.Comments, 1)).To(HaveLen(2), "PR 1 is not fetched a third time")
		})
	})

	Describe("an older-format entry of a pull request GitHub no longer has", func() {
		const (
			fromWindow  = "2026-05-15T00:00:00Z"
			fromDefault = "2026-11-01T05:00:00Z"
			goneMsg     = "cache holds older-format entries of pull requests github no longer has"
			notFound    = `{"data":{"repository":{"pullRequest":null}},"errors":[{"type":"NOT_FOUND","path":["repository","pullRequest"],"message":"Could not resolve to a PullRequest with the number of 2."}]}`
			// notFoundP0 is GitHub's answer to PullRequestNumbers asked about
			// PR 2 alone, which it cannot resolve.
			notFoundP0 = `{"data":{"repository":{"p0":null}},"errors":[{"type":"NOT_FOUND","path":["repository","p0"],"message":"Could not resolve to a PullRequest with the number of 2."}]}`
		)
		var (
			held   []fetch.Entry
			before []byte
			// hidden answers in place of the server while PR 2 is gone in a
			// way the server's state does not show.
			hidden func(fetchtest.Request) *fetchtest.Reply
		)
		metaPath := func() string { return filepath.Join(cacheDir, fetch.MetaFile) }
		rawPath := func(number int) string { return filepath.Join(cacheDir, "raw", strconv.Itoa(number)+".json") }
		// age rewrites entry number as a fetch from before entries carried a
		// format version left it.
		age := func(number int) {
			GinkgoHelper()
			e := readJSON(rawPath(number))
			delete(e, "formatVersion")
			b, err := json.Marshal(e)
			Expect(err).NotTo(HaveOccurred())
			Expect(os.WriteFile(rawPath(number), b, 0o600)).To(Succeed())
		}
		// walkedFrom returns each run's since, as its first log line gives it.
		walkedFrom := func() []any {
			var out []any
			for _, m := range logged("walk started") {
				out = append(out, m["since"])
			}
			return out
		}
		// intercept answers as hidden does, and otherwise as f does.
		intercept := func(f func(fetchtest.Request) *fetchtest.Reply) {
			server.Intercept(func(_ int, r fetchtest.Request) *fetchtest.Reply {
				if hidden != nil {
					if rep := hidden(r); rep != nil {
						return rep
					}
				}
				if f != nil {
					return f(r)
				}
				return nil
			})
		}
		marks := func() any { return readJSON(metaPath())["gone_entries"] }
		// askedByNumber returns the pull request numbers each
		// PullRequestNumbers request asked about, in order.
		askedByNumber := func() [][]int {
			var out [][]int
			for _, r := range server.Operations(ghapi.PullRequestNumbers(0).Name) {
				var numbers []int
				for i := 0; r.Int("n"+strconv.Itoa(i)) >= 0; i++ {
					numbers = append(numbers, r.Int("n"+strconv.Itoa(i)))
				}
				out = append(out, numbers)
			}
			return out
		}
		markOf2 := func() map[string]any {
			return map[string]any{"2": entry(2).FetchedAt.Format(time.RFC3339)}
		}

		BeforeEach(func() {
			gone, still := pr(2, 2, "CLOSED"), pr(1, 1, "CLOSED")
			gone.Comments, still.Comments = comments(3), comments(3)
			held = []fetch.Entry{pr(9, 9, "CLOSED"), gone, still}
			hidden = nil
			serve(held...)
			Expect(run(fetch.WindowStart)).To(Succeed())
			age(2)
			var err error
			before, err = os.ReadFile(rawPath(2))
			Expect(err).NotTo(HaveOccurred())
			defaultSince = true
			logs.Reset()
		})

		for _, way := range []struct {
			name string
			// hide makes GitHub no longer have PR 2.
			hide func()
			// bring makes GitHub list PR 2 again, updated after the default
			// since.
			bring func()
		}{
			{
				name: "deleted, so that no walk lists it",
				hide: func() { server.Delete(2) },
				bring: func() {
					moved := held[1]
					moved.UpdatedAt = at(6)
					serve(held[0], moved, held[2])
				},
			},
			{
				name: "listed but answered NOT_FOUND when read",
				hide: func() {
					hidden = func(r fetchtest.Request) *fetchtest.Reply {
						switch {
						case r.Operation == ghapi.ConnectionPage(ghapi.Comments).Name && r.Int("number") == 2:
							return &fetchtest.Reply{Status: 200, Body: notFound}
						case r.Operation == ghapi.PullRequestNumbers(0).Name && r.Int("n0") == 2 && r.Int("n1") < 0:
							return &fetchtest.Reply{Status: 200, Body: notFoundP0}
						}
						return nil
					}
					intercept(nil)
				},
				bring: func() {
					hidden = nil
					intercept(nil)
					server.Update(2, func(e *fetch.Entry) { e.UpdatedAt = at(6) })
				},
			},
		} {
			Context(way.name, func() {
				BeforeEach(func() { way.hide() })

				It("walks back to the window start once, leaving the entry as it was, and from the default since on the next run", func() {
					Expect(run(at(5))).To(Succeed())
					Expect(run(at(5))).To(Succeed())

					Expect(walkedFrom()).To(Equal([]any{fromWindow, fromDefault}), "log:\n%s", logs.String())
					Expect(os.ReadFile(rawPath(2))).To(Equal(before))
				})

				It("asks GitHub for it by number, in one request, only after the walk from the window start", func() {
					Expect(run(at(5))).To(Succeed())

					Expect(askedByNumber()).To(Equal([][]int{{2}}))
					Expect(logged("asked github about older-format entries the walk left")).To(HaveExactElements(And(
						HaveKeyWithValue("asked", 1.0),
						HaveKeyWithValue("not_found", 1.0),
					)), "log:\n%s", logs.String())
					Expect(marks()).To(Equal(markOf2()))

					Expect(run(at(5))).To(Succeed())

					Expect(askedByNumber()).To(HaveLen(1), "the walk from the default since asks nothing")
				})

				It("keeps the mark in meta.json through a third run", func() {
					for range 3 {
						Expect(run(at(5))).To(Succeed())
					}

					Expect(walkedFrom()).To(Equal([]any{fromWindow, fromDefault, fromDefault}), "log:\n%s", logs.String())
					Expect(marks()).To(Equal(markOf2()))
					Expect(os.ReadFile(rawPath(2))).To(Equal(before))
				})

				It("warns once a run with its number, and counts it in the closing log line, but no longer as an entry to walk back for", func() {
					warned := func() {
						GinkgoHelper()
						Expect(logged(goneMsg)).To(HaveExactElements(And(
							HaveKeyWithValue("level", "WARN"),
							HaveKeyWithValue("pull_requests", 1.0),
							HaveKeyWithValue("numbers", []any{2.0}),
						)), "log:\n%s", logs.String())
						Expect(logged("walk finished")).To(HaveExactElements(HaveKeyWithValue("gone", 1.0)))
					}
					Expect(run(at(5))).To(Succeed())
					warned()
					Expect(logged("cache holds entries of an older format")).To(HaveExactElements(HaveKeyWithValue("entries", 1.0)))
					logs.Reset()

					Expect(run(at(5))).To(Succeed())

					warned()
					Expect(logged("cache holds entries of an older format")).To(BeEmpty())
				})

				It("fetches it as any other once GitHub lists it again, and drops the mark", func() {
					Expect(run(at(5))).To(Succeed())
					way.bring()
					logs.Reset()

					Expect(run(at(5))).To(Succeed())

					Expect(walkedFrom()).To(Equal([]any{fromDefault}))
					Expect(entry(2).FormatVersion).To(Equal(fetch.FormatVersion))
					Expect(entry(2).UpdatedAt).To(Equal(at(6)))
					Expect(marks()).To(BeNil())
					Expect(logged(goneMsg)).To(BeEmpty())
					Expect(logged("walk finished")).To(HaveExactElements(HaveKeyWithValue("gone", 0.0)))
				})

				It("keeps it as it was under --refetch, without walking back", func() {
					Expect(run(at(5))).To(Succeed())
					refetch = true
					logs.Reset()

					Expect(run(at(5))).To(Succeed())

					Expect(walkedFrom()).To(Equal([]any{fromDefault}))
					Expect(os.ReadFile(rawPath(2))).To(Equal(before))
					Expect(marks()).To(Equal(markOf2()))
					Expect(logged("walk finished")).To(HaveExactElements(HaveKeyWithValue("gone", 1.0)))
				})

				It("concludes nothing from a walk from the window start that a rate limit stops", func() {
					intercept(func(r fetchtest.Request) *fetchtest.Reply {
						if _, open := r.Variables["states"]; r.Operation == ghapi.PullRequests.Name && open {
							return rateLimited()
						}
						return nil
					})

					Expect(run(at(5))).To(MatchError(isRateLimit, "a *ghapi.RateLimitError"))

					Expect(marks()).To(BeNil())
					Expect(logged(goneMsg)).To(BeEmpty())
					intercept(nil)
					Expect(run(at(5))).To(Succeed())
					Expect(walkedFrom()).To(Equal([]any{fromWindow, fromWindow}), "the walk after it goes back again")
				})

				It("concludes nothing from a --since walk that stops short of the window start", func() {
					defaultSince = false

					Expect(run(at(5))).To(Succeed())

					Expect(marks()).To(BeNil())
					Expect(logged(goneMsg)).To(BeEmpty())
					defaultSince = true
					Expect(run(at(5))).To(Succeed())
					Expect(walkedFrom()).To(Equal([]any{fromDefault, fromWindow}), "the default walk after it goes back")
				})

				It("concludes from a --full walk", func() {
					defaultSince = false

					Expect(run(fetch.WindowStart)).To(Succeed())

					Expect(marks()).To(Equal(markOf2()))
				})
			})
		}

		It("walks back again for an ordinary older-format entry beside a marked one, and fetches it as before", func() {
			server.Delete(2)
			Expect(run(at(5))).To(Succeed())
			age(1)
			logs.Reset()

			Expect(run(at(5))).To(Succeed())

			Expect(walkedFrom()).To(Equal([]any{fromWindow}))
			Expect(logged("cache holds entries of an older format")).To(HaveExactElements(HaveKeyWithValue("entries", 1.0)))
			Expect(nestedFor(ghapi.Comments, 1)).To(HaveLen(2), "PR 1 is fetched by the first walk and again now")
			Expect(entry(1).FormatVersion).To(Equal(fetch.FormatVersion))
			Expect(os.ReadFile(rawPath(2))).To(Equal(before))
			Expect(marks()).To(Equal(markOf2()))
		})

		It("walks back for a marked entry written again since, by a later fetch, though of an older format again", func() {
			server.Delete(2)
			Expect(run(at(5))).To(Succeed())
			Expect(marks()).To(Equal(markOf2()))
			e := readJSON(rawPath(2))
			e["fetchedAt"] = at(400).Format(time.RFC3339)
			b, err := json.Marshal(e)
			Expect(err).NotTo(HaveOccurred())
			Expect(os.WriteFile(rawPath(2), b, 0o600)).To(Succeed())
			logs.Reset()

			Expect(run(at(5))).To(Succeed())

			Expect(walkedFrom()).To(Equal([]any{fromWindow}), "the mark is of the entry as it was; log:\n%s", logs.String())
			Expect(logged("cache holds entries of an older format")).To(HaveExactElements(HaveKeyWithValue("entries", 1.0)))
			Expect(marks()).To(Equal(map[string]any{"2": "2026-11-17T16:00:00Z"}), "marked again, as the entry now is")
		})

		It("does not carry a mark through a shorter walk onto an entry written again since, though of an older format again", func() {
			server.Delete(2)
			Expect(run(at(5))).To(Succeed())
			Expect(marks()).To(Equal(markOf2()))
			e := readJSON(rawPath(2))
			e["fetchedAt"] = at(400).Format(time.RFC3339)
			b, err := json.Marshal(e)
			Expect(err).NotTo(HaveOccurred())
			Expect(os.WriteFile(rawPath(2), b, 0o600)).To(Succeed())
			defaultSince = false
			logs.Reset()

			Expect(run(at(5))).To(Succeed())

			Expect(walkedFrom()).To(Equal([]any{fromDefault}), "an explicit since, not widened")
			Expect(askedByNumber()).To(HaveLen(1), "only the first walk asked")
			Expect(marks()).To(BeNil(), "the mark was of the entry as it was")
		})

		It("neither marks nor names as gone a pull request the walk missed because it was updated during it, and the next walk fetches it", func() {
			server.Delete(2)
			age(1)
			pageSize = 1
			moved := false
			server.After(func(_ int, r fetchtest.Request) {
				if !moved && r.Operation == ghapi.PullRequests.Name {
					server.Update(1, func(e *fetch.Entry) { e.UpdatedAt = at(300) })
					moved = true
				}
			})

			Expect(run(at(5))).To(Succeed())

			Expect(nestedFor(ghapi.Comments, 1)).To(HaveLen(1), "PR 1 moved past the cursor, and only the first walk fetched it")
			Expect(askedByNumber()).To(Equal([][]int{{1, 2}}))
			Expect(marks()).To(Equal(markOf2()))
			Expect(logged(goneMsg)).To(HaveExactElements(HaveKeyWithValue("numbers", []any{2.0})), "log:\n%s", logs.String())
			Expect(logged("walk finished")).To(HaveExactElements(HaveKeyWithValue("gone", 1.0)))

			Expect(run(at(5))).To(Succeed())
			Expect(run(at(5))).To(Succeed())

			Expect(walkedFrom()).To(Equal([]any{fromWindow, fromWindow, fromDefault}), "log:\n%s", logs.String())
			Expect(entry(1).FormatVersion).To(Equal(fetch.FormatVersion))
			Expect(entry(1).UpdatedAt).To(Equal(at(300)))
			Expect(marks()).To(Equal(markOf2()))
		})

		DescribeTable("fails the run, concluding nothing, when asking GitHub by number fails",
			func(rep fetchtest.Reply, match types.GomegaMatcher) {
				server.Delete(2)
				was, err := os.ReadFile(metaPath())
				Expect(err).NotTo(HaveOccurred())
				intercept(func(r fetchtest.Request) *fetchtest.Reply {
					if r.Operation == ghapi.PullRequestNumbers(0).Name {
						return &rep
					}
					return nil
				})

				Expect(run(at(5))).To(match)

				Expect(os.ReadFile(metaPath())).To(Equal(was))
				Expect(logged(goneMsg)).To(BeEmpty())
				intercept(nil)
				Expect(run(at(5))).To(Succeed())
				Expect(walkedFrom()).To(Equal([]any{fromWindow, fromWindow}), "the walk after it goes back again")
				Expect(marks()).To(Equal(markOf2()))
			},
			Entry("a spent rate limit", *rateLimited(), MatchError(isRateLimit, "a *ghapi.RateLimitError")),
			Entry("a 503 on every attempt", fetchtest.Reply{Status: 503},
				And(MatchError(ghapi.ErrUnavailable), MatchError(ContainSubstring("asking whether cached pull requests exist")))),
			Entry("a GraphQL error other than NOT_FOUND", fetchtest.Reply{Status: 200, Body: `{"errors":[{"type":"FORBIDDEN","message":"Resource not accessible by integration"}]}`},
				MatchError(And(ContainSubstring("asking whether cached pull requests exist"), ContainSubstring("Resource not accessible")))),
			Entry("a NOT_FOUND of the repository rather than the PR", fetchtest.Reply{Status: 200, Body: `{"data":{"repository":null},"errors":[{"type":"NOT_FOUND","path":["repository"],"message":"Could not resolve to a Repository with the name 'rook/rook'."}]}`},
				MatchError(ContainSubstring("Could not resolve to a Repository"))),
			Entry("a reply without the PR", fetchtest.Reply{Status: 200, Body: `{"data":{"repository":{}}}`},
				MatchError(ContainSubstring("no answer for pull request 2 in repository.p0"))),
		)

		It("asks about 25 pull requests a request, names at most 20 of them in the warning, lowest first, and counts every one", func() {
			var prs []fetch.Entry
			for n := 10; n < 36; n++ {
				prs = append(prs, pr(n, 3, "CLOSED"))
			}
			serve(prs...)
			Expect(run(fetch.WindowStart)).To(Succeed())
			left := []int{2}
			for n := 10; n < 36; n++ {
				age(n)
				server.Delete(n)
				left = append(left, n)
			}
			var want []any
			for _, n := range left[:20] {
				want = append(want, float64(n))
			}
			logs.Reset()

			Expect(run(at(5))).To(Succeed())

			Expect(askedByNumber()).To(Equal([][]int{{2}, left[:25], left[25:]}),
				"the walk that cached them asked about PR 2 alone first")
			Expect(logged(goneMsg)).To(HaveExactElements(And(
				HaveKeyWithValue("pull_requests", 27.0),
				HaveKeyWithValue("numbers", want),
			)), "PR 2 and the 26 more; log:\n%s", logs.String())
			Expect(logged("walk finished")).To(HaveExactElements(HaveKeyWithValue("gone", 27.0)))
		})
	})

	It("stops at the first PR updated before --since and does not request the next page", func() {
		serve(pr(5, 5, "CLOSED"), pr(4, 4, "CLOSED"), pr(3, 3, "CLOSED"), pr(2, 2, "CLOSED"), pr(1, 1, "CLOSED"))
		pageSize = 2

		Expect(run(at(3))).To(Succeed())

		Expect(listed(false)).To(Equal([]int{2, 2}), "phase 1 list requests")
		Expect(rawFiles()).To(ConsistOf("3.json", "4.json", "5.json"))
	})

	Describe("meta.json, the coverage mark", func() {
		metaPath := func() string { return filepath.Join(cacheDir, fetch.MetaFile) }

		BeforeEach(func() {
			serve(pr(9, 9, "CLOSED"), pr(1, 1, "CLOSED"))
			defaultSinceAt = at(5)
		})

		It("is left byte-identical by a walk from a since later than the default, which saves its entries and warns once why", func() {
			const old = `{"walk_started":"2026-10-01T00:00:00Z","opened_in_window":1,"open":0}` + "\n"
			Expect(os.WriteFile(metaPath(), []byte(old), 0o600)).To(Succeed())

			Expect(run(at(6))).To(Succeed())

			got, err := os.ReadFile(metaPath())
			Expect(err).NotTo(HaveOccurred())
			Expect(string(got)).To(Equal(old))
			Expect(rawFiles()).To(ConsistOf("9.json"))
			Expect(logged("coverage mark not advanced")).To(HaveExactElements(And(
				HaveKeyWithValue("level", "WARN"),
				HaveKeyWithValue("reason", ContainSubstring("later than the default since")),
				HaveKeyWithValue("since", "2026-11-01T06:00:00Z"),
				HaveKeyWithValue("default_since", "2026-11-01T05:00:00Z"),
			)), "log:\n%s", logs.String())
		})

		It("is not created by a walk from a since later than the default", func() {
			Expect(run(at(6))).To(Succeed())

			Expect(metaPath()).NotTo(BeAnExistingFile())
			Expect(rawFiles()).To(ConsistOf("9.json"))
		})

		DescribeTable("is written by a walk that covers the default range",
			func(since, defaultAt time.Time) {
				defaultSinceAt = defaultAt

				Expect(run(since)).To(Succeed())

				Expect(readJSON(metaPath())).To(HaveKeyWithValue("walk_started", "2026-11-15T12:00:00Z"))
				Expect(logged("coverage mark not advanced")).To(BeEmpty())
			},
			Entry("since at the default", at(5), at(5)),
			Entry("since before the default", at(4), at(5)),
			Entry("no default, as for --full, whatever the since", at(6), time.Time{}),
		)
	})

	It("caches a PR listed twice once, at the later updatedAt, and skips one listed twice unchanged", func() {
		moving := pr(8, 8, "OPEN")
		moving.Comments = comments(3)
		still := pr(9, 9, "OPEN")
		still.Comments = comments(3)
		serve(moving, still)
		server.After(func(n int, _ fetchtest.Request) {
			if n == 0 {
				server.Update(8, func(e *fetch.Entry) {
					e.UpdatedAt = at(20)
					e.Comments = append(e.Comments, fetch.Comment{CreatedAt: at(19), Body: "late", Author: user("dave")})
				})
			}
		})

		Expect(run(fetch.WindowStart)).To(Succeed())

		e := entry(8)
		Expect(e.UpdatedAt).To(Equal(at(20)))
		Expect(e.Comments).To(HaveLen(4))
		Expect(e.Comments[3].Body).To(Equal("late"))
		Expect(nestedFor(ghapi.Comments, 8)).To(HaveLen(2), "PR 8 is fetched in both phases")
		Expect(nestedFor(ghapi.Comments, 9)).To(HaveLen(1), "PR 9 is fetched once")
		Expect(rawFiles()).To(ConsistOf("8.json", "9.json"))
	})

	It("makes no nested-page requests on a second run over an unchanged server", func() {
		open := pr(3, 3, "OPEN")
		open.Commits = commits(5)
		closed := pr(2, 2, "CLOSED")
		closed.Reviews = reviews(3)
		serve(open, closed)
		Expect(run(fetch.WindowStart)).To(Succeed())
		first := len(server.Requests())
		before, err := os.ReadFile(filepath.Join(cacheDir, "raw", "3.json"))
		Expect(err).NotTo(HaveOccurred())

		Expect(run(fetch.WindowStart)).To(Succeed())

		var ops []string
		for _, r := range server.Requests()[first:] {
			ops = append(ops, r.Operation)
		}
		Expect(ops).To(HaveEach(BeElementOf(ghapi.PullRequests.Name, ghapi.Counts.Name, ghapi.SearchCount.Name)))
		Expect(os.ReadFile(filepath.Join(cacheDir, "raw", "3.json"))).To(Equal(before))
	})

	Describe("a later run over a cache that holds every PR", func() {
		BeforeEach(func() {
			changed, unchanged, open := pr(2, 2, "CLOSED"), pr(3, 3, "CLOSED"), pr(4, 4, "OPEN")
			changed.Comments, unchanged.Comments, open.Comments = comments(3), comments(3), comments(3)
			serve(changed, unchanged, open)
			Expect(run(fetch.WindowStart)).To(Succeed())
			server.Update(2, func(e *fetch.Entry) {
				e.UpdatedAt = at(6)
				e.Title = "retitled at a later updatedAt"
			})
			for _, n := range []int{3, 4} {
				server.Update(n, func(e *fetch.Entry) { e.Title = "retitled without moving updatedAt" })
			}
		})

		DescribeTable("fetches a PR updated since it was cached, and one cached at the same updatedAt only when refetching, once in a run though listed twice",
			func(again bool, downloads int) {
				refetch = again

				Expect(run(fetch.WindowStart)).To(Succeed())

				Expect(nestedFor(ghapi.Comments, 2)).To(HaveLen(2), "PR 2, updated, is downloaded by both runs")
				Expect(entry(2).Title).To(Equal("retitled at a later updatedAt"))
				for _, n := range []int{3, 4} {
					title := "pr " + strconv.Itoa(n)
					if again {
						title = "retitled without moving updatedAt"
					}
					Expect(nestedFor(ghapi.Comments, n)).To(HaveLen(downloads), "PR %d's downloads over both runs", n)
					Expect(entry(n).Title).To(Equal(title), "PR %d", n)
				}
			},
			Entry("without refetching, keeping each unchanged entry as it was", false, 1),
			Entry("refetching, replacing each, the open one listed by both phases once", true, 2),
		)

		It("downloads every PR in range again when a refetching run is repeated, rather than resuming", func() {
			refetch = true
			Expect(run(fetch.WindowStart)).To(Succeed())

			Expect(run(fetch.WindowStart)).To(Succeed())

			Expect(nestedFor(ghapi.Comments, 3)).To(HaveLen(3))
		})

		It("keeps an entry cached at a later updatedAt than the listing gives, though refetching", func() {
			path := filepath.Join(cacheDir, "raw", "3.json")
			e := readJSON(path)
			e["updatedAt"] = at(10).Format(time.RFC3339)
			b, err := json.Marshal(e)
			Expect(err).NotTo(HaveOccurred())
			Expect(os.WriteFile(path, b, 0o600)).To(Succeed())
			refetch = true

			Expect(run(fetch.WindowStart)).To(Succeed())

			Expect(nestedFor(ghapi.Comments, 3)).To(HaveLen(1))
			Expect(entry(3).UpdatedAt).To(Equal(at(10)))
		})
	})

	It("retries two empty responses and then succeeds at the same page size", func() {
		serve(pr(1, 1, "CLOSED"))
		server.Intercept(func(n int, _ fetchtest.Request) *fetchtest.Reply {
			if n < 2 {
				return &fetchtest.Reply{Status: 200}
			}
			return nil
		})

		Expect(run(fetch.WindowStart)).To(Succeed())

		Expect(listed(false)).To(Equal([]int{25, 25, 25}))
		Expect(waits).To(Equal([]int{1, 2}))
		Expect(rawFiles()).To(ConsistOf("1.json"))
	})

	It("halves the page size after three failures and keeps the smaller size", func() {
		var prs []fetch.Entry
		for n := range 8 {
			prs = append(prs, pr(n+1, n+1, "CLOSED"))
		}
		serve(prs...)
		server.Intercept(func(_ int, r fetchtest.Request) *fetchtest.Reply {
			if r.Operation == ghapi.PullRequests.Name && r.Int("first") > 6 {
				return &fetchtest.Reply{Status: 502, Body: "<html>bad gateway</html>"}
			}
			return nil
		})

		Expect(run(fetch.WindowStart)).To(Succeed())

		Expect(listed(false)).To(Equal([]int{25, 25, 25, 12, 12, 12, 6, 6}))
		Expect(listed(true)).To(Equal([]int{6}))
		Expect(rawFiles()).To(HaveLen(8))
	})

	It("gives up after three failures at a page size of 1", func() {
		serve(pr(1, 1, "CLOSED"))
		server.Intercept(func(int, fetchtest.Request) *fetchtest.Reply {
			return &fetchtest.Reply{Status: 503}
		})

		err := run(fetch.WindowStart)

		Expect(err).To(MatchError(ghapi.ErrUnavailable))
		Expect(listed(false)).To(Equal([]int{25, 25, 25, 12, 12, 12, 6, 6, 6, 3, 3, 3, 1, 1, 1}))
	})

	It("ends the run on a rate limit, naming the reset time, and keeps earlier entries", func() {
		serve(pr(3, 3, "CLOSED"), pr(2, 2, "CLOSED"), pr(1, 1, "CLOSED"))
		pageSize = 1
		server.Intercept(func(_ int, r fetchtest.Request) *fetchtest.Reply {
			if r.Operation == ghapi.PullRequests.Name && r.Variables["after"] == "o2" {
				return &fetchtest.Reply{Status: 403, Header: map[string]string{
					"x-ratelimit-remaining": "0", "x-ratelimit-reset": "1794747600",
				}}
			}
			return nil
		})

		err := run(fetch.WindowStart)

		rl, ok := errors.AsType[*ghapi.RateLimitError](err)
		Expect(ok).To(BeTrue(), "error %v is not a RateLimitError", err)
		Expect(rl.Reset).To(BeTemporally("==", time.Date(2026, 11, 15, 13, 0, 0, 0, time.UTC)))
		Expect(err.Error()).To(ContainSubstring("2026-11-15T13:00:00Z"))
		Expect(rawFiles()).To(ConsistOf("3.json", "2.json"), "only whole entries, no temporary files")
		Expect(entry(3).Number).To(Equal(3))
		Expect(entry(2).Number).To(Equal(2))
		Expect(filepath.Join(cacheDir, "meta.json")).NotTo(BeAnExistingFile())
	})

	DescribeTable("saves no entry for a PR whose nested page fails, keeps those before it, and writes no meta.json",
		func(rep fetchtest.Reply, match types.GomegaMatcher) {
			failing := pr(2, 2, "CLOSED")
			failing.Comments = comments(3)
			serve(pr(9, 9, "CLOSED"), failing)
			server.Intercept(func(_ int, r fetchtest.Request) *fetchtest.Reply {
				if r.Operation == ghapi.ConnectionPage(ghapi.Comments).Name {
					return &rep
				}
				return nil
			})

			err := run(fetch.WindowStart)

			Expect(err).To(match)
			Expect(rawFiles()).To(ConsistOf("9.json"), "PR 2 is not saved, nor any temporary file")
			Expect(filepath.Join(cacheDir, fetch.MetaFile)).NotTo(BeAnExistingFile())
		},
		Entry("a 503 on every attempt", fetchtest.Reply{Status: 503},
			And(MatchError(ghapi.ErrUnavailable), MatchError(ContainSubstring("pull request 2")))),
		Entry("a spent rate limit", *rateLimited(),
			MatchError(isRateLimit, "a *ghapi.RateLimitError resetting at 2026-11-15T13:00:00Z")),
		Entry("a reply without the connection's key", fetchtest.Reply{Status: 200, Body: `{"data":{"repository":{"pullRequest":{}}}}`},
			And(
				MatchError(And(ContainSubstring("pull request 2"), ContainSubstring("comments"))),
				Not(MatchError(ghapi.ErrUnavailable)),
			)),
		Entry("a reply whose connection is null", fetchtest.Reply{Status: 200, Body: `{"data":{"repository":{"pullRequest":{"comments":null}}}}`},
			And(
				MatchError(And(ContainSubstring("pull request 2"), ContainSubstring("comments"))),
				Not(MatchError(ghapi.ErrUnavailable)),
			)),
		Entry("a GraphQL error other than NOT_FOUND", fetchtest.Reply{Status: 200, Body: `{"errors":[{"type":"FORBIDDEN","message":"Resource not accessible by integration"}]}`},
			And(
				MatchError(And(ContainSubstring("pull request 2"), ContainSubstring("Resource not accessible by integration"))),
				Not(MatchError(ghapi.ErrUnavailable)),
			)),
		Entry("a NOT_FOUND of the repository rather than the PR", fetchtest.Reply{Status: 200, Body: `{"data":{"repository":null},"errors":[{"type":"NOT_FOUND","path":["repository"],"message":"Could not resolve to a Repository with the name 'rook/rook'."}]}`},
			MatchError(And(ContainSubstring("pull request 2"), ContainSubstring("Could not resolve to a Repository")))),
	)

	DescribeTable("skips a listed PR that GitHub can no longer resolve when asked for the rest of it, warning once with its number, saves the others, and counts it as the run ends",
		func(gone fetch.Entry) {
			serve(pr(9, 9, "CLOSED"), gone)
			server.After(func(n int, _ fetchtest.Request) {
				if n == 0 {
					server.Delete(gone.Number)
				}
			})

			Expect(run(fetch.WindowStart)).To(Succeed())

			Expect(rawFiles()).To(ConsistOf("9.json"))
			Expect(logged("skipping a pull request github cannot resolve")).To(HaveExactElements(And(
				HaveKeyWithValue("level", "WARN"),
				HaveKeyWithValue("number", 2.0),
			)), "log:\n%s", logs.String())
			Expect(logged("walk finished")).To(HaveExactElements(HaveKeyWithValue("unresolved", 1.0)))
			Expect(filepath.Join(cacheDir, fetch.MetaFile)).To(BeAnExistingFile())
		},
		Entry("a further page of its comments", func() fetch.Entry {
			p := pr(2, 2, "CLOSED")
			p.Comments = comments(3)
			return p
		}()),
		Entry("its commits' names, its author's account deleted", func() fetch.Entry {
			p := pr(2, 2, "CLOSED")
			p.Author = nil
			p.Commits = commits(1)
			return p
		}()),
	)

	It("leaves the entry it held for a PR updated since as it was when GitHub can no longer resolve the PR, and writes nothing for it", func() {
		held := pr(2, 2, "CLOSED")
		held.Comments = comments(3)
		serve(pr(9, 9, "CLOSED"), held)
		Expect(run(fetch.WindowStart)).To(Succeed())
		path := filepath.Join(cacheDir, "raw", "2.json")
		before, err := os.ReadFile(path)
		Expect(err).NotTo(HaveOccurred())
		server.Update(2, func(e *fetch.Entry) { e.UpdatedAt = at(5) })
		deleted := false
		server.After(func(_ int, r fetchtest.Request) {
			if !deleted && r.Operation == ghapi.PullRequests.Name {
				server.Delete(2)
				deleted = true
			}
		})
		logs.Reset()

		Expect(run(fetch.WindowStart)).To(Succeed())

		Expect(os.ReadFile(path)).To(Equal(before))
		Expect(rawFiles()).To(ConsistOf("2.json", "9.json"), "no other file, temporary or not")
		Expect(logged("skipping a pull request github cannot resolve")).To(HaveExactElements(HaveKeyWithValue("number", 2.0)))
		Expect(logged("walk finished")).To(HaveExactElements(HaveKeyWithValue("unresolved", 1.0)))
	})

	DescribeTable("is an error naming the PR and the connection when a listed PR lacks one, and saves nothing",
		func(labels string) {
			serveLinksPage(func(s string) string {
				return strings.Replace(s, `"labels": {"pageInfo": {"hasNextPage": false, "endCursor": null}, "nodes": []},`, labels, 1)
			})

			err := run(fetch.WindowStart)

			Expect(err).To(MatchError(And(ContainSubstring("pull request 69877"), ContainSubstring("labels"))))
			Expect(err).NotTo(MatchError(ghapi.ErrUnavailable))
			_, rerr := fetch.ReadEntry(cacheDir, 69877)
			Expect(rerr).To(MatchError(fs.ErrNotExist), "no entry for PR 69877")
			Expect(filepath.Join(cacheDir, fetch.MetaFile)).NotTo(BeAnExistingFile())
		},
		Entry("labels missing", ``),
		Entry("labels null", `"labels": null,`),
	)

	DescribeTable("is an error naming the author, and writes no baselines for the batch, when an answer is not a count",
		func(answer string) {
			bob := pr(2, 2, "CLOSED")
			bob.Author = user("bob")
			serve(pr(1, 1, "CLOSED"), bob)
			server.Intercept(func(_ int, r fetchtest.Request) *fetchtest.Reply {
				if r.Operation == ghapi.AuthorBaselines(0).Name {
					return &fetchtest.Reply{Status: 200, Body: `{"data":{"a0":{"issueCount":3},"a1":` + answer + `}}`}
				}
				return nil
			})

			err := run(fetch.WindowStart)

			Expect(err).To(MatchError(And(ContainSubstring("counting prior pull requests"), ContainSubstring("bob"))))
			Expect(filepath.Join(cacheDir, fetch.AuthorsFile)).NotTo(BeAnExistingFile())
			Expect(filepath.Join(cacheDir, fetch.MetaFile)).NotTo(BeAnExistingFile())
		},
		Entry("a null alias", `null`),
		Entry("an alias without issueCount", `{}`),
	)

	DescribeTable("is an error naming the connection when a list page lacks it, and writes nothing",
		func(body string) {
			serve(pr(1, 1, "CLOSED"))
			server.Intercept(func(_ int, r fetchtest.Request) *fetchtest.Reply {
				if r.Operation == ghapi.PullRequests.Name {
					return &fetchtest.Reply{Status: 200, Body: body}
				}
				return nil
			})

			err := run(fetch.WindowStart)

			Expect(err).To(MatchError(ContainSubstring("pullRequests")))
			Expect(err).NotTo(MatchError(ghapi.ErrUnavailable))
			Expect(filepath.Join(cacheDir, fetch.RawDir)).NotTo(BeAnExistingFile(), "no entry is written")
			Expect(filepath.Join(cacheDir, fetch.MetaFile)).NotTo(BeAnExistingFile())
		},
		Entry("without repository", `{"data":{}}`),
		Entry("without pullRequests", `{"data":{"repository":{}}}`),
	)

	It("keeps the author baselines already written when a rate limit ends the run between batches, and writes no meta.json", func() {
		var prs []fetch.Entry
		for n := range 27 {
			p := pr(n+1, n+1, "CLOSED")
			p.Author = user(fmt.Sprintf("dev%02d", n))
			prs = append(prs, p)
		}
		serve(prs...)
		server.Intercept(func(_ int, r fetchtest.Request) *fetchtest.Reply {
			if r.Operation == ghapi.AuthorBaselines(0).Name && len(server.Operations(r.Operation)) == 2 {
				return rateLimited()
			}
			return nil
		})

		err := run(fetch.WindowStart)

		Expect(err).To(MatchError(isRateLimit, "a *ghapi.RateLimitError resetting at 2026-11-15T13:00:00Z"))
		Expect(server.Operations(ghapi.AuthorBaselines(0).Name)).To(HaveLen(2))
		authors := readJSON(filepath.Join(cacheDir, fetch.AuthorsFile))["authors"]
		Expect(authors).To(HaveLen(25), "the first batch is kept")
		Expect(authors).To(HaveKey("dev00"))
		Expect(authors).NotTo(HaveKey("dev26"))
		Expect(filepath.Join(cacheDir, fetch.MetaFile)).NotTo(BeAnExistingFile())
	})

	It("keeps the token out of every log line and every cache file", func() {
		serve(pr(2, 2, "OPEN"), pr(1, 1, "CLOSED"))
		server.Intercept(func(n int, _ fetchtest.Request) *fetchtest.Reply {
			if n == 0 {
				return &fetchtest.Reply{Status: 502}
			}
			return nil
		})

		Expect(run(fetch.WindowStart)).To(Succeed())

		Expect(server.Requests()).To(HaveEach(HaveField("Authorization", "bearer "+token)))
		Expect(logs.String()).To(ContainSubstring("retrying graphql request"))
		Expect(logs.String()).NotTo(ContainSubstring(token))
		Expect(filepath.WalkDir(cacheDir, func(path string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return err
			}
			b, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			if bytes.Contains(b, []byte(token)) {
				return fmt.Errorf("token in %s", path)
			}
			return nil
		})).To(Succeed())
	})

	It("records each new human author's prior PRs and GitHub's counts", func() {
		bot := pr(4, 4, "CLOSED")
		bot.Author = &fetch.Actor{Login: "dependabot", Typename: "Bot"}
		ghost := pr(3, 3, "CLOSED")
		ghost.Author = nil
		known := pr(2, 2, "OPEN")
		known.Author = user("carol")
		bob := pr(5, 5, "OPEN")
		bob.Author = user("bob")
		serve(pr(1, 1, "CLOSED"), pr(6, 6, "MERGED"), bot, ghost, known, bob)
		server.SetCounts(42, map[string]int{"alice": 3, "bob": 0, "carol": 99})
		Expect(os.WriteFile(filepath.Join(cacheDir, "authors.json"),
			[]byte(`{"window_start": "2026-05-15T00:00:00Z", "authors": {"carol": 7}}`), 0o600)).To(Succeed())

		Expect(run(fetch.WindowStart)).To(Succeed())

		baselines := server.Operations(ghapi.AuthorBaselines(0).Name)
		Expect(baselines).To(HaveLen(1))
		Expect(baselines[0].Variables).To(Equal(map[string]any{
			"q0": "repo:rook/rook is:pr author:alice created:<2026-05-15",
			"q1": "repo:rook/rook is:pr author:bob created:<2026-05-15",
		}))
		Expect(readJSON(filepath.Join(cacheDir, "authors.json"))).To(Equal(map[string]any{
			"window_start": "2026-05-15T00:00:00Z",
			"authors":      map[string]any{"alice": 3.0, "bob": 0.0, "carol": 7.0},
		}))
		Expect(logged("asking every author's prior pull requests again")).To(BeEmpty())

		Expect(server.Operations(ghapi.Counts.Name)).To(HaveLen(1))
		Expect(searched()).To(Equal([]string{"repo:rook/rook is:pr created:>=2026-05-15"}))
		Expect(readJSON(filepath.Join(cacheDir, "meta.json"))).To(Equal(map[string]any{
			"window_start":            "2026-05-15T00:00:00Z",
			"walk_started":            "2026-11-15T12:00:00Z",
			"opened_in_window":        42.0,
			"opened_in_window_source": "search",
			"open":                    2.0,
			"deleted_authors_named":   true,
		}))
	})

	DescribeTable("asks every author again, rewriting authors.json for the window, and warns once why, when the cached baselines are",
		func(cached, reason string) {
			known := pr(2, 2, "OPEN")
			known.Author = user("carol")
			serve(pr(1, 1, "CLOSED"), known)
			server.SetCounts(2, map[string]int{"alice": 3, "carol": 99})
			Expect(os.WriteFile(filepath.Join(cacheDir, "authors.json"), []byte(cached), 0o600)).To(Succeed())

			Expect(run(fetch.WindowStart)).To(Succeed())

			baselines := server.Operations(ghapi.AuthorBaselines(0).Name)
			Expect(baselines).To(HaveLen(1))
			Expect(baselines[0].Variables).To(Equal(map[string]any{
				"q0": "repo:rook/rook is:pr author:alice created:<2026-05-15",
				"q1": "repo:rook/rook is:pr author:carol created:<2026-05-15",
			}))
			Expect(readJSON(filepath.Join(cacheDir, "authors.json"))).To(Equal(map[string]any{
				"window_start": "2026-05-15T00:00:00Z",
				"authors":      map[string]any{"alice": 3.0, "carol": 99.0},
			}))
			Expect(logged("asking every author's prior pull requests again")).To(HaveExactElements(And(
				HaveKeyWithValue("level", "WARN"),
				HaveKeyWithValue("reason", reason),
				HaveKeyWithValue("window_start", "2026-05-15T00:00:00Z"),
				HaveKeyWithValue("authors", 2.0),
			)), "log:\n%s", logs.String())
		},
		Entry("a bare map, as written before authors.json recorded its window",
			`{"carol": 7, "erin": 1}`, "the file does not record the window they were asked for"),
		Entry("asked for another window",
			`{"window_start": "2026-07-01T00:00:00Z", "authors": {"carol": 7, "erin": 1}}`, "they were asked for the window from 2026-07-01"),
	)

	It("leaves nothing a later run trusts when it stops between batches of baselines asked again", func() {
		var prs []fetch.Entry
		stale := map[string]int{}
		for n := range 27 {
			p := pr(n+1, n+1, "CLOSED")
			login := fmt.Sprintf("dev%02d", n)
			p.Author = user(login)
			prs = append(prs, p)
			stale[login] = 99
		}
		serve(prs...)
		b, err := json.Marshal(stale)
		Expect(err).NotTo(HaveOccurred())
		Expect(os.WriteFile(filepath.Join(cacheDir, "authors.json"), b, 0o600)).To(Succeed())
		server.Intercept(func(_ int, r fetchtest.Request) *fetchtest.Reply {
			if r.Operation == ghapi.AuthorBaselines(0).Name && len(server.Operations(r.Operation)) == 2 {
				return rateLimited()
			}
			return nil
		})

		Expect(run(fetch.WindowStart)).To(MatchError(isRateLimit, "a *ghapi.RateLimitError"))

		after := readJSON(filepath.Join(cacheDir, "authors.json"))
		Expect(after).To(HaveKeyWithValue("window_start", "2026-05-15T00:00:00Z"))
		Expect(after["authors"]).To(HaveLen(25), "only the first batch, asked again")
		Expect(after["authors"]).To(HaveEach(0.0), "none of the stale counts")
		Expect(filepath.Join(cacheDir, "meta.json")).NotTo(BeAnExistingFile())

		server.Intercept(nil)
		Expect(run(fetch.WindowStart)).To(Succeed())

		last := server.Operations(ghapi.AuthorBaselines(0).Name)
		Expect(last[len(last)-1].Variables).To(HaveLen(2), "the second run asks only the two left")
		Expect(readJSON(filepath.Join(cacheDir, "authors.json"))["authors"]).To(And(HaveLen(27), HaveEach(0.0)))
	})

	It("asks for at most 25 authors in one request", func() {
		var prs []fetch.Entry
		for n := range 27 {
			p := pr(n+1, n+1, "CLOSED")
			p.Author = user(fmt.Sprintf("dev%02d", n))
			prs = append(prs, p)
		}
		serve(prs...)

		Expect(run(fetch.WindowStart)).To(Succeed())

		var sizes []int
		for _, r := range server.Operations(ghapi.AuthorBaselines(0).Name) {
			sizes = append(sizes, len(r.Variables))
		}
		Expect(sizes).To(Equal([]int{25, 2}))
		Expect(readJSON(filepath.Join(cacheDir, "authors.json"))).To(HaveKeyWithValue("authors", HaveLen(27)))
	})

	It("asks for the baselines and counts from rook/rook's creation by default, by the listing alone", func() {
		window = time.Time{}
		serve(pr(1, 1, "OPEN"))

		Expect(run(fetch.WindowStart)).To(Succeed())

		baselines := server.Operations(ghapi.AuthorBaselines(0).Name)
		Expect(baselines).To(HaveLen(1))
		Expect(baselines[0].Variables).To(Equal(map[string]any{
			"q0": "repo:rook/rook is:pr author:alice created:<2016-07-08",
		}))
		Expect(server.Operations(ghapi.Counts.Name)).To(HaveLen(1))
		Expect(searched()).To(BeEmpty())
		Expect(readJSON(filepath.Join(cacheDir, fetch.MetaFile))).To(HaveKeyWithValue("opened_in_window_source", "listing"))
	})

	Describe("GitHub's counts", func() {
		metaPath := func() string { return filepath.Join(cacheDir, fetch.MetaFile) }

		BeforeEach(func() {
			// Three pull requests, one open; the search counts two of them.
			serve(pr(3, 3, "OPEN"), pr(2, 2, "CLOSED"), pr(1, 1, "MERGED"))
			server.SetCreatedAt(created)
			server.SetCounts(2, map[string]int{"alice": 0})
		})

		DescribeTable("count the pull requests opened in the window, recording which count it is, and the open ones by the listing, asking the search only for a window the listing cannot count",
			func(start time.Time, opened float64, source string, searches []string) {
				window = start

				Expect(run(fetch.WindowStart)).To(Succeed())

				Expect(readJSON(metaPath())).To(Equal(map[string]any{
					"window_start":            start.Format(time.RFC3339),
					"walk_started":            "2026-11-15T12:00:00Z",
					"opened_in_window":        opened,
					"opened_in_window_source": source,
					"open":                    1.0,
					"deleted_authors_named":   true,
				}))
				Expect(server.Operations(ghapi.Counts.Name)).To(HaveLen(1))
				Expect(searched()).To(Equal(searches))
			},
			Entry("by the listing's total when the window starts at the repository's creation",
				created, 3.0, "listing", nil),
			Entry("by the listing's total when the window starts before the repository's creation",
				time.Date(2016, 7, 8, 0, 0, 0, 0, time.UTC), 3.0, "listing", nil),
			Entry("by the search when the window starts a day after the repository's creation",
				created.Add(24*time.Hour), 2.0, "search", []string{"repo:rook/rook is:pr created:>=2016-07-09"}),
		)

		Context("when GitHub's search fails", func() {
			BeforeEach(func() {
				server.Intercept(func(_ int, r fetchtest.Request) *fetchtest.Reply {
					if _, ok := r.Variables["search"]; ok {
						return &fetchtest.Reply{Status: 200, Body: `{"errors":[{"message":"Something went wrong while executing your query."}]}`}
					}
					return nil
				})
			})

			It("counts a window that starts at the repository's creation by the listing, never asking the search", func() {
				window = created

				Expect(run(fetch.WindowStart)).To(Succeed())

				Expect(readJSON(metaPath())).To(And(
					HaveKeyWithValue("opened_in_window", 3.0),
					HaveKeyWithValue("opened_in_window_source", "listing"),
					HaveKeyWithValue("open", 1.0),
				))
				Expect(server.Operations(ghapi.Counts.Name)).To(HaveLen(1))
				Expect(searched()).To(BeEmpty())
			})

			It("is an error naming the search for a window that starts later, and writes no meta.json", func() {
				window = created.Add(24 * time.Hour)

				err := run(fetch.WindowStart)

				Expect(err).To(MatchError(And(ContainSubstring("GitHub's search"), ContainSubstring("Something went wrong"))))
				Expect(server.Operations(ghapi.Counts.Name)).To(HaveLen(1))
				Expect(searched()).To(HaveLen(1))
				Expect(metaPath()).NotTo(BeAnExistingFile())
			})
		})

		DescribeTable("is an error naming what the reply lacks, and writes no meta.json",
			func(op, body, missing string) {
				window = created.Add(24 * time.Hour)
				server.Intercept(func(_ int, r fetchtest.Request) *fetchtest.Reply {
					if r.Operation == op {
						return &fetchtest.Reply{Status: 200, Body: body}
					}
					return nil
				})

				err := run(fetch.WindowStart)

				Expect(err).To(MatchError(And(ContainSubstring("counting pull requests"), ContainSubstring(missing))))
				Expect(err).NotTo(MatchError(ghapi.ErrUnavailable))
				Expect(metaPath()).NotTo(BeAnExistingFile())
			},
			Entry("without createdAt", ghapi.Counts.Name,
				`{"data":{"repository":{"total":{"totalCount":3},"open":{"totalCount":1}}}}`,
				"reply without repository.createdAt"),
			Entry("with a null createdAt", ghapi.Counts.Name,
				`{"data":{"repository":{"createdAt":null,"total":{"totalCount":3},"open":{"totalCount":1}}}}`,
				"reply without repository.createdAt"),
			Entry("without the total", ghapi.Counts.Name,
				`{"data":{"repository":{"createdAt":"2016-07-08T17:30:00Z","open":{"totalCount":1}}}}`,
				"reply without repository.pullRequests.totalCount"),
			Entry("with a total without its count", ghapi.Counts.Name,
				`{"data":{"repository":{"createdAt":"2016-07-08T17:30:00Z","total":{},"open":{"totalCount":1}}}}`,
				"reply without repository.pullRequests.totalCount"),
			Entry("without the open total", ghapi.Counts.Name,
				`{"data":{"repository":{"createdAt":"2016-07-08T17:30:00Z","total":{"totalCount":3}}}}`,
				"reply without repository.pullRequests(states: OPEN).totalCount"),
			Entry("without repository", ghapi.Counts.Name,
				`{"data":{}}`,
				"reply without repository.createdAt"),
			Entry("without the search's count", ghapi.SearchCount.Name,
				`{"data":{"search":{}}}`,
				"reply without search.issueCount"),
		)
	})
})

var _ = Describe("the source repository", func() {
	It("is rook/rook, read from the day it was created", func() {
		Expect(fetch.Owner + "/" + fetch.Name).To(Equal("rook/rook"))
		Expect(fetch.WindowStart).To(Equal(time.Date(2016, 7, 8, 0, 0, 0, 0, time.UTC)))
	})
})

var _ = Describe("ReadMeta", func() {
	var cacheDir string

	BeforeEach(func() {
		cacheDir = GinkgoT().TempDir()
	})

	write := func(content string) {
		GinkgoHelper()
		Expect(os.WriteFile(filepath.Join(cacheDir, fetch.MetaFile), []byte(content), 0o600)).To(Succeed())
	}

	It("reads the counts and their source", func() {
		write(`{"window_start":"2016-07-08T00:00:00Z","walk_started":"2026-11-15T12:00:00Z","opened_in_window":73914,"opened_in_window_source":"listing","open":2035}`)

		Expect(fetch.ReadMeta(cacheDir)).To(Equal(fetch.Meta{
			WindowStart:          fetch.WindowStart,
			WalkStarted:          walkStart,
			OpenedInWindow:       73914,
			OpenedInWindowSource: record.SourceListing,
			Open:                 2035,
		}))
	})

	It("reads whether every deleted account's entry holds its names, and a meta.json written before it recorded that as not yet", func() {
		write(`{"window_start":"2016-07-08T00:00:00Z","walk_started":"2026-11-15T12:00:00Z","opened_in_window":73914,"opened_in_window_source":"listing","open":2035,"deleted_authors_named":true}`)
		Expect(fetch.ReadMeta(cacheDir)).To(HaveField("DeletedAuthorsNamed", true))

		write(`{"window_start":"2016-07-08T00:00:00Z","walk_started":"2026-11-15T12:00:00Z","opened_in_window":73914,"opened_in_window_source":"listing","open":2035}`)
		Expect(fetch.ReadMeta(cacheDir)).To(HaveField("DeletedAuthorsNamed", false))
	})

	It("reads a meta.json written before it recorded the source as counted by the search, as every count then was", func() {
		write(`{"window_start":"2016-07-08T00:00:00Z","walk_started":"2026-11-15T12:00:00Z","opened_in_window":72447,"open":2035}`)

		Expect(fetch.ReadMeta(cacheDir)).To(HaveField("OpenedInWindowSource", record.SourceSearch))
	})

	It("is an error matching fs.ErrNotExist when there is none", func() {
		_, err := fetch.ReadMeta(cacheDir)
		Expect(err).To(MatchError(fs.ErrNotExist))
	})

	It("is an error naming the file when it is malformed", func() {
		write(`{"walk_started":"yesterday"}`)

		_, err := fetch.ReadMeta(cacheDir)
		Expect(err).To(MatchError(ContainSubstring(filepath.Join(cacheDir, fetch.MetaFile))))
	})
})

var _ = Describe("DefaultSince", func() {
	var dataDir string

	BeforeEach(func() {
		dataDir = GinkgoT().TempDir()
	})

	It("is the window start when there is no meta", func() {
		Expect(fetch.DefaultSince(dataDir)).To(Equal(fetch.WindowStart))
	})

	It("is a day before the last fetch", func() {
		Expect(os.WriteFile(filepath.Join(dataDir, "meta.json"),
			[]byte(`{"repo":"rook/rook","fetched_through":"2026-11-10T06:00:00Z","open":3}`), 0o600)).To(Succeed())

		Expect(fetch.DefaultSince(dataDir)).To(Equal(time.Date(2026, 11, 9, 6, 0, 0, 0, time.UTC)))
	})

	DescribeTable("by the window the meta records",
		func(window string, want time.Time) {
			Expect(os.WriteFile(filepath.Join(dataDir, "meta.json"),
				[]byte(`{"repo":"rook/rook","window_start":"`+window+`","fetched_through":"2026-11-10T06:00:00Z"}`), 0o600)).To(Succeed())

			Expect(fetch.DefaultSince(dataDir)).To(Equal(want))
		},
		Entry("the window start, when the data's window starts later, so the walk reaches what the data never covered",
			"2026-07-01T00:00:00Z", fetch.WindowStart),
		Entry("a day before the last fetch, when the data's window is the window in force",
			fetch.WindowStart.Format(time.RFC3339), time.Date(2026, 11, 9, 6, 0, 0, 0, time.UTC)),
	)

	It("is an error naming the file when the meta cannot be read", func() {
		path := filepath.Join(dataDir, "meta.json")
		Expect(os.WriteFile(path, []byte(`{"fetched_through":"yesterday"}`), 0o600)).To(Succeed())

		_, err := fetch.DefaultSince(dataDir)

		Expect(err).To(MatchError(ContainSubstring(path)))
	})
})

func readJSON(path string) map[string]any {
	b, err := os.ReadFile(path)
	Expect(err).NotTo(HaveOccurred())
	var out map[string]any
	Expect(json.Unmarshal(b, &out)).To(Succeed(), "%s: %s", path, b)
	return out
}

package extract_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/jhoblitt/rook-dev-stats/internal/extract"
	"github.com/jhoblitt/rook-dev-stats/internal/fetch"
	"github.com/jhoblitt/rook-dev-stats/internal/record"
)

// file is what a spec knows of a file under the data directory: its bytes,
// and its identity, which a rewrite through rename replaces.
type file struct {
	content string
	info    os.FileInfo
}

// specWindow is the window the specs' 2026 fixtures are dated around,
// some PRs before it and some after.
var specWindow = time.Date(2026, 5, 15, 0, 0, 0, 0, time.UTC)

// otherWindow is a window baselines and counts were asked for that is not
// specWindow.
var otherWindow = time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)

var _ = Describe("Run", func() {
	var (
		cacheDir, dataDir string
		// window is run's Config.WindowStart; zero takes the default.
		window time.Time
	)

	BeforeEach(func() {
		cacheDir = GinkgoT().TempDir()
		dataDir = GinkgoT().TempDir()
		window = specWindow
	})

	writeJSON := func(path string, v any) {
		GinkgoHelper()
		b, err := json.MarshalIndent(v, "", "  ")
		Expect(err).NotTo(HaveOccurred())
		Expect(os.MkdirAll(filepath.Dir(path), 0o750)).To(Succeed())
		Expect(os.WriteFile(path, b, 0o600)).To(Succeed())
	}

	cache := func(entries ...fetch.Entry) {
		GinkgoHelper()
		for _, e := range entries {
			writeJSON(filepath.Join(cacheDir, fetch.RawDir, strconv.Itoa(e.Number)+".json"), e)
		}
	}

	// windowInForce is the window run extracts for.
	windowInForce := func() time.Time {
		if window.IsZero() {
			return fetch.WindowStart
		}
		return window
	}

	// baselines writes the cache's authors.json as fetch does, asked for
	// the window in force.
	baselines := func(authors map[string]int) {
		GinkgoHelper()
		writeJSON(filepath.Join(cacheDir, fetch.AuthorsFile), map[string]any{"window_start": windowInForce(), "authors": authors})
	}

	// counts writes the cache's meta.json as fetch does, counted for the
	// window in force.
	counts := func(walkStarted time.Time, openedInWindow, open int) {
		GinkgoHelper()
		writeJSON(filepath.Join(cacheDir, fetch.MetaFile), map[string]any{
			"window_start": windowInForce(), "walk_started": walkStarted,
			"opened_in_window": openedInWindow, "open": open,
		})
	}

	extractErr := func() error {
		return extract.Run(context.Background(), extract.Config{CacheDir: cacheDir, DataDir: dataDir, WindowStart: window, Logger: quiet()})
	}

	run := func() {
		GinkgoHelper()
		Expect(extractErr()).To(Succeed())
	}

	files := func() map[string]file {
		GinkgoHelper()
		out := map[string]file{}
		Expect(filepath.WalkDir(dataDir, func(path string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return err
			}
			b, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			info, err := os.Stat(path)
			if err != nil {
				return err
			}
			rel, err := filepath.Rel(dataDir, path)
			out[rel] = file{content: string(b), info: info}
			return err
		})).To(Succeed())
		return out
	}

	// rewritten lists the files of after that are new or were replaced
	// since before.
	rewritten := func(before, after map[string]file) []string {
		var out []string
		for name, a := range after {
			if b, ok := before[name]; !ok || !os.SameFile(a.info, b.info) {
				out = append(out, name)
			}
		}
		return out
	}

	records := func() map[int]record.Record {
		GinkgoHelper()
		recs, err := record.ReadRecords(dataDir)
		Expect(err).NotTo(HaveOccurred())
		out := map[int]record.Record{}
		for _, r := range recs {
			out[r.Number] = r
		}
		return out
	}

	day := func(month time.Month, d int) time.Time {
		return time.Date(2026, month, d, 12, 0, 0, 0, time.UTC)
	}

	It("records every cached PR by month, and copies the cache's authors and meta", func() {
		cache(fixture("backport"), fixture("draft-ready"), fixture("ghost"), fixture("reopened"))
		baselines(map[string]int{"erin-example": 0, "alice-example": 12})
		counts(time.Date(2026, 11, 15, 12, 0, 0, 123_000_000, time.UTC), 4985, 2019)

		run()

		Expect(files()).To(HaveLen(6))
		Expect(records()).To(HaveLen(4))
		Expect(files()).To(HaveKey(filepath.Join(record.PRsDir, "2026-05.jsonl")))
		Expect(files()).To(HaveKey(filepath.Join(record.PRsDir, "2026-06.jsonl")))
		Expect(files()).To(HaveKey(filepath.Join(record.PRsDir, "2026-07.jsonl")))
		Expect(files()).To(HaveKey(filepath.Join(record.PRsDir, "2026-08.jsonl")))
		Expect(record.ReadAuthors(dataDir)).To(Equal(map[string]int{"alice-example": 12, "erin-example": 0}))
		Expect(files()[record.MetaFile].content).To(Equal(`{
  "repo": "ceph/ceph",
  "window_start": "2026-05-15T00:00:00Z",
  "fetched_through": "2026-11-15T12:00:00Z",
  "github_counts": {
    "opened_in_window": 4985,
    "opened_in_window_source": "search",
    "open": 2019
  }
}
`), "the cache's meta.json records no source, as fetch wrote it when every count was the search's")
	})

	DescribeTable("copies the source of GitHub's count of pull requests opened in the window into data/meta.json",
		func(source string, want record.CountSource) {
			cache(fixture("backport"))
			baselines(map[string]int{"alice-example": 12})
			meta := map[string]any{
				"window_start": windowInForce(), "walk_started": day(11, 15),
				"opened_in_window": 73914, "open": 2035,
			}
			if source != "" {
				meta["opened_in_window_source"] = source
			}
			writeJSON(filepath.Join(cacheDir, fetch.MetaFile), meta)

			run()

			Expect(record.ReadMeta(dataDir)).To(HaveField("GitHubCounts", record.Counts{
				OpenedInWindow: 73914, OpenedInWindowSource: want, Open: 2035,
			}))
		},
		Entry("the listing", "listing", record.SourceListing),
		Entry("the search", "search", record.SourceSearch),
		Entry("the search, for a cache meta.json that records none", "", record.SourceSearch),
	)

	It("writes nothing with an empty cache", func() {
		run()
		Expect(files()).To(BeEmpty())
	})

	It("changes no file with an empty cache over existing data", func() {
		cache(fixture("backport"), fixture("draft-ready"))
		baselines(map[string]int{"alice-example": 12})
		counts(day(11, 15), 0, 0)
		run()
		before := files()

		cacheDir = GinkgoT().TempDir()
		run()

		Expect(rewritten(before, files())).To(BeEmpty())
		Expect(files()).To(HaveLen(len(before)))
	})

	It("writes identical bytes and touches no file on a second run", func() {
		cache(fixture("backport"), fixture("draft-ready"), fixture("reopened"), fixture("force-pushed"), fixture("late-commits"), fixture("ghost"))
		baselines(map[string]int{"alice-example": 12})
		counts(day(11, 15), 0, 0)
		run()
		before := files()

		run()
		after := files()
		Expect(rewritten(before, after)).To(BeEmpty())
		Expect(after).To(HaveLen(len(before)))
		for name, f := range before {
			Expect(after[name].content).To(Equal(f.content), "file %s", name)
		}
	})

	It("rewrites exactly one monthly file after one PR changed", func() {
		changed := fixture("draft-ready")
		cache(fixture("backport"), changed, fixture("reopened"), fixture("force-pushed"))
		run()
		before := files()

		changed.UpdatedAt = changed.UpdatedAt.Add(time.Hour)
		changed.State = "MERGED"
		cache(changed)
		run()

		Expect(rewritten(before, files())).To(ConsistOf(filepath.Join(record.PRsDir, "2026-07.jsonl")))
		Expect(records()[changed.Number].State).To(Equal(record.StateMerged))
	})

	It("re-derives a record from a current-format cache entry at the same updatedAt", func() {
		e := fixture("force-pushed")
		e.FormatVersion = fetch.FormatVersion
		cache(e)
		run()

		e.Title = "a title changed without moving updatedAt"
		cache(e)
		run()

		Expect(records()[e.Number].Title).To(Equal("a title changed without moving updatedAt"))
	})

	It("keeps a record whose cache entry is older, or as old and of an older format, and warns once with their count", func() {
		older := fixture("force-pushed")
		oldFormat := fixture("draft-ready")
		oldFormat.FormatVersion = fetch.FormatVersion
		cache(older, oldFormat)
		run()
		before := records()

		older.UpdatedAt = older.UpdatedAt.Add(-time.Hour)
		older.Title = "a title from an older entry"
		oldFormat.FormatVersion = fetch.FormatVersion - 1
		oldFormat.Title = "a title from an entry of an older format"
		cache(older, oldFormat)
		var logs bytes.Buffer
		logger := slog.New(slog.NewJSONHandler(&logs, nil))
		Expect(extract.Run(context.Background(), extract.Config{CacheDir: cacheDir, DataDir: dataDir, Logger: logger})).To(Succeed())

		Expect(records()).To(Equal(before))
		var warnings []map[string]any
		for line := range bytes.Lines(logs.Bytes()) {
			var m map[string]any
			Expect(json.Unmarshal(line, &m)).To(Succeed(), "log line %s", line)
			if m["level"] == "WARN" {
				warnings = append(warnings, m)
			}
		}
		Expect(warnings).To(HaveExactElements(And(
			HaveKeyWithValue("msg", "cache entries older than their records"),
			HaveKeyWithValue("entries", 2.0),
			HaveKeyWithValue("example", float64(min(older.Number, oldFormat.Number))),
		)), "log:\n%s", logs.String())
	})

	It("counts an author's earlier PRs in the window on top of their baseline", func() {
		cache(
			entry(10, "kim", day(4, 1)),
			entry(20, "kim", day(6, 1)),
			entry(21, "lee", day(6, 2)),
			entry(30, "kim", day(7, 1)),
			entry(40, "kim", day(8, 1)),
		)
		baselines(map[string]int{"kim": 4, "lee": 0})

		run()

		got := records()
		Expect(got[10].PriorPRs).To(BeNil(), "PR opened before the window")
		Expect(got[20].PriorPRs).To(HaveValue(Equal(4)), "kim's first PR in the window")
		Expect(got[30].PriorPRs).To(HaveValue(Equal(5)), "kim's second PR in the window")
		Expect(got[40].PriorPRs).To(HaveValue(Equal(6)), "kim's third PR in the window")
		Expect(got[21].PriorPRs).To(HaveValue(Equal(0)), "lee's first PR")
	})

	It("counts a PR opened exactly at the window start as in the window", func() {
		cache(entry(1, "kim", window))
		baselines(map[string]int{"kim": 4})

		run()

		Expect(records()[1].PriorPRs).To(HaveValue(Equal(4)))
	})

	It("recomputes prior_prs over every record when a backfill adds an earlier PR", func() {
		cache(entry(30, "kim", day(7, 1)))
		baselines(map[string]int{"kim": 4})
		counts(day(11, 15), 1, 1)
		run()
		Expect(records()[30].PriorPRs).To(HaveValue(Equal(4)))
		before := files()

		cacheDir = GinkgoT().TempDir()
		cache(entry(20, "kim", day(6, 1)))
		run()

		Expect(records()[30].PriorPRs).To(HaveValue(Equal(5)))
		Expect(rewritten(before, files())).To(ConsistOf(
			filepath.Join(record.PRsDir, "2026-06.jsonl"),
			filepath.Join(record.PRsDir, "2026-07.jsonl"),
		))
	})

	It("leaves prior_prs null for an author with no baseline", func() {
		ghost := entry(1, "ghost", day(6, 1))
		ghost.Author = nil
		cache(ghost, entry(2, "dependabot", day(6, 2)))
		baselines(map[string]int{"kim": 4})

		run()

		Expect(records()[1].Author).To(Equal(record.Actor{Login: fetch.GhostLogin}))
		Expect(records()[1].PriorPRs).To(BeNil())
		Expect(records()[2].PriorPRs).To(BeNil())
	})

	It("names a deleted account's pull requests and still leaves their prior_prs null, though one name opened both", func() {
		names := &fetch.CommitNames{Commits: []fetch.CommitName{{OID: "1", Author: "Kim Example", Committer: "Ivy Example"}}}
		first, second := entry(1, "ghost", day(6, 1)), entry(2, "ghost", day(6, 2))
		first.Author, second.Author = nil, nil
		first.CommitNames, second.CommitNames = names, names
		cache(first, second)
		baselines(map[string]int{"kim": 4})

		run()

		for _, n := range []int{1, 2} {
			Expect(records()[n].Author).To(Equal(record.Actor{Login: fetch.GhostLogin, Name: "Ivy Example"}), "PR %d", n)
			Expect(records()[n].PriorPRs).To(BeNil(), "PR %d", n)
		}
	})

	It("names a deleted account's record once fetch completes its cached entry, at the same updatedAt", func() {
		ghost := entry(1, "ghost", day(6, 1))
		ghost.Author = &fetch.Actor{Login: fetch.GhostLogin, Typename: "User"}
		ghost.FormatVersion = fetch.FormatVersion
		cache(ghost)
		run()
		Expect(records()[1].Author).To(Equal(record.Actor{Login: fetch.GhostLogin}))

		ghost.CommitNames = &fetch.CommitNames{Commits: []fetch.CommitName{{OID: "1", Author: "Kim Example", Committer: "Ivy Example"}}}
		cache(ghost)
		run()

		Expect(records()[1].Author).To(Equal(record.Actor{Login: fetch.GhostLogin, Name: "Ivy Example"}))
	})

	Context("with the default window", func() {
		BeforeEach(func() {
			window = time.Time{}
		})

		It("starts it when ceph/ceph was created, leaving prior_prs null only before that", func() {
			cache(
				entry(1, "kim", time.Date(2011, 8, 31, 23, 59, 59, 0, time.UTC)),
				entry(2, "kim", time.Date(2011, 9, 1, 0, 0, 0, 0, time.UTC)),
			)
			baselines(map[string]int{"kim": 0})
			counts(day(11, 15), 0, 0)

			run()

			Expect(records()[1].PriorPRs).To(BeNil(), "PR opened a second before the window")
			Expect(records()[2].PriorPRs).To(HaveValue(Equal(0)), "PR opened at the window start")
			Expect(record.ReadMeta(dataDir)).To(HaveField("WindowStart", time.Date(2011, 9, 1, 0, 0, 0, 0, time.UTC)))
		})

		It("counts every earlier record of a human author, and leaves a bot's and a deleted account's null", func() {
			bot := entry(5, "dependabot", time.Date(2019, 3, 1, 0, 0, 0, 0, time.UTC))
			bot.Author.Typename = "Bot"
			ghost := entry(6, "ghost", time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC))
			ghost.Author = nil
			cache(
				entry(1, "kim", time.Date(2013, 2, 1, 0, 0, 0, 0, time.UTC)),
				entry(2, "lee", time.Date(2015, 6, 1, 0, 0, 0, 0, time.UTC)),
				entry(3, "kim", time.Date(2018, 4, 1, 0, 0, 0, 0, time.UTC)),
				bot,
				ghost,
				entry(4, "kim", day(4, 1)),
				entry(7, "kim", day(8, 1)),
			)
			baselines(map[string]int{"kim": 0, "lee": 0})

			run()

			got := records()
			Expect(got[1].PriorPRs).To(HaveValue(Equal(0)), "kim's first PR, in 2013")
			Expect(got[3].PriorPRs).To(HaveValue(Equal(1)), "kim's second PR")
			Expect(got[4].PriorPRs).To(HaveValue(Equal(2)), "kim's third PR")
			Expect(got[7].PriorPRs).To(HaveValue(Equal(3)), "kim's fourth PR")
			Expect(got[2].PriorPRs).To(HaveValue(Equal(0)), "lee's first PR")
			Expect(got[5].PriorPRs).To(BeNil(), "a bot's PR")
			Expect(got[6].Author).To(Equal(record.Actor{Login: fetch.GhostLogin}))
			Expect(got[6].PriorPRs).To(BeNil(), "a deleted account's PR")
		})
	})

	It("adds the cache's baselines to the committed ones of the same window", func() {
		Expect(record.WriteMeta(dataDir, record.Meta{Repo: "ceph/ceph", WindowStart: window, FetchedThrough: day(11, 1)})).To(BeTrue())
		Expect(record.WriteAuthors(dataDir, map[string]int{"kim": 4, "lee": 1})).To(BeTrue())
		baselines(map[string]int{"lee": 2, "max": 7})

		run()

		Expect(record.ReadAuthors(dataDir)).To(Equal(map[string]int{"kim": 4, "lee": 2, "max": 7}))
	})

	Describe("baselines and counts of another window", func() {
		BeforeEach(func() {
			cache(entry(10, "kim", day(8, 1)), entry(20, "kim", day(9, 1)), entry(30, "lee", day(9, 2)))
		})

		DescribeTable("refuses the cache's, naming the file, its window and the fetch that replaces it, and writes nothing",
			func(file string, content any, want string) {
				baselines(map[string]int{"kim": 0, "lee": 0})
				counts(day(11, 15), 3, 3)
				writeJSON(filepath.Join(cacheDir, file), content)

				err := extractErr()

				Expect(err).To(MatchError(And(
					ContainSubstring(filepath.Join(cacheDir, file)),
					ContainSubstring(want),
					ContainSubstring("not for the window from 2026-05-15"),
					ContainSubstring("run `rookstats fetch`"),
				)))
				Expect(files()).To(BeEmpty())
			},
			Entry("baselines in a bare map, as written before they recorded their window",
				fetch.AuthorsFile, map[string]int{"kim": 4, "lee": 9}, "baselines are for no recorded window"),
			Entry("baselines asked for another window",
				fetch.AuthorsFile, map[string]any{"window_start": otherWindow, "authors": map[string]int{"kim": 4}}, "baselines are for the window from 2026-07-01"),
			Entry("counts with no window, as written before they recorded it",
				fetch.MetaFile, map[string]any{"walk_started": day(11, 15), "opened_in_window": 3, "open": 3}, "counts are for no recorded window"),
			Entry("counts of another window",
				fetch.MetaFile, map[string]any{"window_start": otherWindow, "walk_started": day(11, 15), "opened_in_window": 3, "open": 3}, "counts are for the window from 2026-07-01"),
		)

		Context("in the committed data", func() {
			BeforeEach(func() {
				Expect(record.WriteMeta(dataDir, record.Meta{Repo: "ceph/ceph", WindowStart: otherWindow, FetchedThrough: day(10, 1)})).To(BeTrue())
				Expect(record.WriteAuthors(dataDir, map[string]int{"kim": 40, "lee": 9})).To(BeTrue())
			})

			It("replaces data/authors.json with the cache's baselines rather than carrying it into the records", func() {
				baselines(map[string]int{"kim": 1})
				counts(day(11, 15), 3, 3)

				run()

				got := records()
				Expect(got[10].PriorPRs).To(HaveValue(Equal(1)), "kim's first PR: the cache's baseline")
				Expect(got[20].PriorPRs).To(HaveValue(Equal(2)), "kim's second PR")
				Expect(got[30].PriorPRs).To(BeNil(), "lee has a baseline only for the committed window")
				Expect(record.ReadAuthors(dataDir)).To(Equal(map[string]int{"kim": 1}))
				Expect(record.ReadMeta(dataDir)).To(HaveField("WindowStart", specWindow))
			})

			DescribeTable("refuses it when the cache cannot replace it, and writes nothing",
				func(cacheFile, want string) {
					before := files()
					if cacheFile == fetch.AuthorsFile {
						baselines(map[string]int{"kim": 1})
					} else {
						counts(day(11, 15), 3, 3)
					}

					err := extractErr()

					Expect(err).To(MatchError(And(ContainSubstring(want), ContainSubstring("run `rookstats fetch`"))))
					Expect(rewritten(before, files())).To(BeEmpty())
				},
				Entry("no meta.json in the cache", fetch.AuthorsFile, "meta.json is for the window from 2026-07-01, not for the window from 2026-05-15"),
				Entry("no authors.json in the cache", fetch.MetaFile, "authors.json is for the window from 2026-07-01, not for the window from 2026-05-15"),
			)
		})
	})

	It("leaves the committed meta alone when the cache has none", func() {
		meta := record.Meta{Repo: "ceph/ceph", WindowStart: window, FetchedThrough: day(11, 1)}
		Expect(record.WriteMeta(dataDir, meta)).To(BeTrue())
		cache(fixture("ghost"))

		run()

		Expect(record.ReadMeta(dataDir)).To(Equal(meta))
	})

	It("reads only <number>.json entries from the cache", func() {
		cache(fixture("ghost"))
		Expect(os.WriteFile(filepath.Join(cacheDir, fetch.RawDir, ".70007.json.123.tmp"), []byte("{"), 0o600)).To(Succeed())
		Expect(os.WriteFile(filepath.Join(cacheDir, fetch.RawDir, "notes.txt"), []byte("{"), 0o600)).To(Succeed())

		run()

		Expect(records()).To(HaveLen(1))
	})

	It("gives the count of withheld lines by a well-formed domain, other or no address in its closing log line, and no address or name", func() {
		e := entry(1, "alice", day(6, 1))
		e.Commits = []fetch.Commit{{
			AuthoredDate: day(6, 1), CommittedDate: day(6, 1),
			Message: "rgw: fix\n\nCo-authored-by: Claude Dupont <claude.dupont@example.com>\nCo-authored-by: Claude <noreply@anthropic.com>\nCo-authored-by: Claude Martin\n",
		}}
		e.Body = "Original-Author: Claude X <x@y>\nCo-authored-by: Ana Smith <ana.smith@Example.com>, Claude\nGenerated with Claude, ask jo@exa_mple.com\n"
		cache(e)
		var logs bytes.Buffer
		logger := slog.New(slog.NewJSONHandler(&logs, nil))

		Expect(extract.Run(context.Background(), extract.Config{CacheDir: cacheDir, DataDir: dataDir, Logger: logger})).To(Succeed())

		var finished []map[string]any
		for line := range bytes.Lines(logs.Bytes()) {
			var m map[string]any
			Expect(json.Unmarshal(line, &m)).To(Succeed(), "log line %s", line)
			if m["msg"] == "extract finished" {
				finished = append(finished, m)
			}
		}
		Expect(finished).To(HaveExactElements(HaveKeyWithValue("withheld_by_domain", map[string]any{"example.com": 2.0, "y": 1.0, "other": 1.0, "no address": 1.0})), "log:\n%s", logs.String())
		for _, s := range []string{"@", "claude.dupont", "Dupont", "Ana", "Smith", "Martin", "exa_mple"} {
			Expect(logs.String()).NotTo(ContainSubstring(s), "log:\n%s", logs.String())
		}
		Expect(records()[1].Disclosure.Trailers).To(Equal([]string{"Co-authored-by: Claude <noreply@anthropic.com>"}))
	})

	It("is an error naming the entry when one cannot be read", func() {
		path := filepath.Join(cacheDir, fetch.RawDir, "5.json")
		Expect(os.MkdirAll(filepath.Dir(path), 0o750)).To(Succeed())
		Expect(os.WriteFile(path, []byte("{"), 0o600)).To(Succeed())

		err := extract.Run(context.Background(), extract.Config{CacheDir: cacheDir, DataDir: dataDir, Logger: quiet()})

		Expect(err).To(MatchError(ContainSubstring(path)))
		Expect(files()).To(BeEmpty())
	})
})

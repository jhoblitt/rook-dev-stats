package extract_test

import (
	"bytes"
	"context"
	"encoding/json"
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

var _ = Describe("links back to GitHub", func() {
	ts := func(s string) time.Time {
		GinkgoHelper()
		t, err := time.Parse(time.RFC3339, s)
		Expect(err).NotTo(HaveOccurred())
		return t
	}

	Describe("FromEntry", func() {
		It("gives the expected record for a PR with every kind of link", func() {
			r, err := extract.FromEntry(fixture("links"))
			Expect(err).NotTo(HaveOccurred())

			got, err := json.Marshal(r)
			Expect(err).NotTo(HaveOccurred())
			want, err := os.ReadFile(filepath.Join("testdata", "links.record.json"))
			Expect(err).NotTo(HaveOccurred())
			Expect(got).To(MatchJSON(want))
		})

		It("fills every link field from the cached ids, addresses and SHAs", func() {
			r, err := extract.FromEntry(fixture("links"))

			Expect(err).NotTo(HaveOccurred())
			Expect(r.Commits.List).To(Equal([]record.Commit{
				{SHA: "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d", Authored: ts("2026-08-31T10:00:00Z"), Committed: ts("2026-09-03T09:00:00Z")},
				{SHA: "2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e", Authored: ts("2026-08-30T10:00:00Z"), Committed: ts("2026-09-03T09:00:00Z")},
				{SHA: "3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f", Authored: ts("2026-09-01T07:00:00Z"), Committed: ts("2026-09-03T09:05:00Z")},
			}), "commits in GitHub's order, times in UTC")
			Expect(r.Comments).To(HaveExactElements(HaveField("ID", int64(4854682435))))
			Expect(r.Reviews).To(HaveExactElements(HaveField("ID", int64(3123456789))))
			Expect(r.Events).To(Equal([]record.Event{
				{At: ts("2026-09-03T09:10:00Z"), Kind: record.KindForcePush, SHA: "3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f"},
				{At: ts("2026-09-03T10:00:00Z"), Kind: record.KindReady, ID: 28644873432},
				{At: ts("2026-09-06T00:00:00Z"), Kind: record.KindClosed, ID: 28700000001},
				{At: ts("2026-09-07T00:00:00Z"), Kind: record.KindReopened},
				{At: ts("2026-09-12T09:00:00Z"), Kind: record.KindMerged, ID: 28800000002, SHA: "4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f70"},
				{At: ts("2026-09-12T09:00:00Z"), Kind: record.KindClosed, ID: 28800000003},
			}))
		})

		It("writes a reopening with neither id nor sha", func() {
			r, err := extract.FromEntry(fixture("links"))
			Expect(err).NotTo(HaveOccurred())

			reopened := r.Events[3]
			Expect(reopened.Kind).To(Equal(record.KindReopened))
			Expect(json.Marshal(reopened)).To(MatchJSON(`{"at":"2026-09-07T00:00:00Z","kind":"reopened"}`))
		})

		It("leaves out every link field of an entry cached before entries carried them", func() {
			r, err := extract.FromEntry(fixture("force-pushed"))
			Expect(err).NotTo(HaveOccurred())

			b, err := json.Marshal(r)
			Expect(err).NotTo(HaveOccurred())
			Expect(string(b)).NotTo(ContainSubstring(`"id"`))
			Expect(string(b)).NotTo(ContainSubstring(`"sha"`))
			Expect(r.Commits.List).To(HaveLen(r.Commits.Count), "the commit list is kept, without SHAs")
		})

		DescribeTable("leaves out the id of an event whose address does not end in #event-<digits>",
			func(url string) {
				e := entry(1, "alice", ts("2026-06-01T00:00:00Z"))
				e.TimelineItems = []fetch.Event{{Typename: "ClosedEvent", CreatedAt: e.CreatedAt, URL: url}}

				r, err := extract.FromEntry(e)

				Expect(err).NotTo(HaveOccurred())
				Expect(r.Events).To(Equal([]record.Event{{At: e.CreatedAt, Kind: record.KindClosed}}), "address %q", url)
			},
			Entry("an issue comment's address", "https://github.com/ceph/ceph/pull/1#issuecomment-5"),
			Entry("no digits", "https://github.com/ceph/ceph/pull/1#event-"),
			Entry("something after the digits", "https://github.com/ceph/ceph/pull/1#event-12x"),
			Entry("more digits than an int64 holds", "https://github.com/ceph/ceph/pull/1#event-99999999999999999999"),
		)
	})

	Describe("Run", func() {
		var cacheDir, dataDir string

		BeforeEach(func() {
			cacheDir = GinkgoT().TempDir()
			dataDir = GinkgoT().TempDir()
		})

		cache := func(entries ...fetch.Entry) {
			GinkgoHelper()
			for _, e := range entries {
				b, err := json.Marshal(e)
				Expect(err).NotTo(HaveOccurred())
				path := filepath.Join(cacheDir, fetch.RawDir, strconv.Itoa(e.Number)+".json")
				Expect(os.MkdirAll(filepath.Dir(path), 0o750)).To(Succeed())
				Expect(os.WriteFile(path, b, 0o600)).To(Succeed())
			}
		}

		It("logs the addresses it cannot read an event id from once per run, not once per event", func() {
			odd := func(number int, at time.Time) fetch.Entry {
				e := entry(number, "alice", at)
				e.TimelineItems = []fetch.Event{
					{Typename: "ClosedEvent", CreatedAt: at, URL: "https://github.com/ceph/ceph/pull/" + strconv.Itoa(number) + "#closed"},
					{Typename: "ReopenedEvent", CreatedAt: at.Add(time.Hour)},
					{Typename: "ClosedEvent", CreatedAt: at.Add(2 * time.Hour)},
				}
				return e
			}
			cache(odd(1, ts("2026-06-01T00:00:00Z")), odd(2, ts("2026-06-02T00:00:00Z")), fixture("links"))
			var logs bytes.Buffer
			logger := slog.New(slog.NewJSONHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug}))

			Expect(extract.Run(context.Background(), extract.Config{CacheDir: cacheDir, DataDir: dataDir, Logger: logger})).To(Succeed())

			var warnings []map[string]any
			for line := range bytes.Lines(logs.Bytes()) {
				var m map[string]any
				Expect(json.Unmarshal(line, &m)).To(Succeed(), "log line %s", line)
				if m["msg"] == "event addresses without an event id" {
					warnings = append(warnings, m)
				}
			}
			Expect(warnings).To(HaveExactElements(And(
				HaveKeyWithValue("level", "WARN"),
				HaveKeyWithValue("events", 2.0),
				HaveKeyWithValue("example", "https://github.com/ceph/ceph/pull/1#closed"),
			)), "log:\n%s", logs.String())
		})

		It("keeps a linked record's bytes when an entry of an older format has the same updatedAt", func() {
			cache(fixture("links"))
			Expect(extract.Run(context.Background(), extract.Config{CacheDir: cacheDir, DataDir: dataDir, Logger: quiet()})).To(Succeed())
			month := filepath.Join(dataDir, record.PRsDir, "2026-09.jsonl")
			linked, err := os.ReadFile(month)
			Expect(err).NotTo(HaveOccurred())
			Expect(string(linked)).To(ContainSubstring(`"sha":`), "the first run links the record")
			before, err := os.Stat(month)
			Expect(err).NotTo(HaveOccurred())

			old := fixture("links")
			old.FormatVersion = 0
			for i := range old.Commits {
				old.Commits[i].OID = ""
			}
			for i := range old.Comments {
				old.Comments[i].DatabaseID = 0
			}
			for i := range old.Reviews {
				old.Reviews[i].DatabaseID = 0
			}
			for i := range old.TimelineItems {
				old.TimelineItems[i] = fetch.Event{Typename: old.TimelineItems[i].Typename, CreatedAt: old.TimelineItems[i].CreatedAt}
			}
			cache(old)
			Expect(extract.Run(context.Background(), extract.Config{CacheDir: cacheDir, DataDir: dataDir, Logger: quiet()})).To(Succeed())

			kept, err := os.ReadFile(month)
			Expect(err).NotTo(HaveOccurred())
			Expect(string(kept)).To(Equal(string(linked)), "the old-format entry stripped the record's links")
			after, err := os.Stat(month)
			Expect(err).NotTo(HaveOccurred())
			Expect(os.SameFile(before, after)).To(BeTrue(), "%s was rewritten", month)
		})

		It("gives a record written before records carried links its links on a plain run, and a second plain run rewrites nothing", func() {
			old, err := os.ReadFile(filepath.Join("testdata", "links.before-links.jsonl"))
			Expect(err).NotTo(HaveOccurred())
			month := filepath.Join(dataDir, record.PRsDir, "2026-09.jsonl")
			Expect(os.MkdirAll(filepath.Dir(month), 0o750)).To(Succeed())
			Expect(os.WriteFile(month, old, 0o600)).To(Succeed())
			cache(fixture("links"))

			Expect(extract.Run(context.Background(), extract.Config{CacheDir: cacheDir, DataDir: dataDir, Logger: quiet()})).To(Succeed())

			recs, err := record.ReadRecords(dataDir)
			Expect(err).NotTo(HaveOccurred())
			want, err := extract.FromEntry(fixture("links"))
			Expect(err).NotTo(HaveOccurred())
			Expect(recs).To(Equal([]record.Record{want}), "the entry, at the record's updatedAt, re-derives it")
			before, err := os.Stat(month)
			Expect(err).NotTo(HaveOccurred())

			Expect(extract.Run(context.Background(), extract.Config{CacheDir: cacheDir, DataDir: dataDir, Logger: quiet()})).To(Succeed())

			after, err := os.Stat(month)
			Expect(err).NotTo(HaveOccurred())
			Expect(os.SameFile(before, after)).To(BeTrue(), "the second run replaced %s", month)
		})
	})
})

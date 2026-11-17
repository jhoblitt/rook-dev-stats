package cli_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/jhoblitt/rook-dev-stats/internal/cli"
	"github.com/jhoblitt/rook-dev-stats/internal/fetch"
	"github.com/jhoblitt/rook-dev-stats/internal/fetch/fetchtest"
	"github.com/jhoblitt/rook-dev-stats/internal/ghapi"
	"github.com/jhoblitt/rook-dev-stats/internal/record"
	"github.com/jhoblitt/rook-dev-stats/internal/tables"
)

var _ = Describe("fetch", func() {
	const token = "ghp_cli-spec-token-never-written"

	var (
		stderr   *bytes.Buffer
		server   *fetchtest.Server
		cacheDir string
		dataDir  string
	)

	closedPR := func(number int, updated time.Time) fetch.Entry {
		return fetch.Entry{
			Number: number, Title: "pr", State: "CLOSED", CreatedAt: updated.Add(-time.Hour),
			UpdatedAt: updated, ClosedAt: &updated, BaseRefName: "master",
			Author: &fetch.Actor{Login: "alice", Typename: "User"},
		}
	}

	BeforeEach(func() {
		stderr = &bytes.Buffer{}
		cacheDir = GinkgoT().TempDir()
		dataDir = GinkgoT().TempDir()
		for _, key := range []string{"ROOKSTATS_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"} {
			GinkgoT().Setenv(key, "")
		}
		server = fetchtest.NewServer(
			closedPR(2, time.Date(2026, 11, 14, 0, 0, 0, 0, time.UTC)),
			closedPR(1, time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)),
		)
		DeferCleanup(server.Close)
	})

	run := func(args ...string) error {
		args = append([]string{
			"--log-level", "debug", "fetch",
			"--api-url", server.URL, "--cache-dir", cacheDir, "--data", dataDir,
		}, args...)
		return cli.Run(context.Background(), args, &bytes.Buffer{}, &bytes.Buffer{}, stderr)
	}

	cached := func() []string {
		des, err := os.ReadDir(filepath.Join(cacheDir, fetch.RawDir))
		Expect(err).NotTo(HaveOccurred())
		var names []string
		for _, de := range des {
			names = append(names, de.Name())
		}
		return names
	}

	It("is an error before any request when no token is in the environment", func() {
		Expect(run()).To(MatchError(ghapi.ErrNoToken))
		Expect(server.Requests()).To(BeEmpty())
	})

	It("sends the token from the environment and keeps it out of the logs and the cache", func() {
		GinkgoT().Setenv("GH_TOKEN", token)

		Expect(run()).To(Succeed())

		Expect(server.Requests()).To(HaveEach(HaveField("Authorization", "bearer "+token)))
		Expect(stderr.String()).To(ContainSubstring(`"msg":"walk finished"`))
		Expect(stderr.String()).NotTo(ContainSubstring(token))
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

	Context("with a token", func() {
		BeforeEach(func() {
			GinkgoT().Setenv("ROOKSTATS_GITHUB_TOKEN", token)
		})

		It("walks back to the window start when there is no data/meta.json", func() {
			Expect(run()).To(Succeed())
			Expect(cached()).To(ConsistOf("1.json", "2.json"))
		})

		It("walks back to a day before data/meta.json's fetched_through", func() {
			Expect(os.WriteFile(filepath.Join(dataDir, "meta.json"),
				[]byte(`{"fetched_through":"2026-11-14T12:00:00Z"}`), 0o600)).To(Succeed())

			Expect(run()).To(Succeed())

			Expect(cached()).To(ConsistOf("2.json"))
		})

		It("walks back to the window start with --full", func() {
			Expect(os.WriteFile(filepath.Join(dataDir, "meta.json"),
				[]byte(`{"fetched_through":"2026-11-14T12:00:00Z"}`), 0o600)).To(Succeed())

			Expect(run("--full")).To(Succeed())

			Expect(cached()).To(ConsistOf("1.json", "2.json"))
		})

		It("walks back to --since, and without data/meta.json leaves the coverage mark unwritten", func() {
			Expect(run("--since", "2026-11-01T00:00:00Z")).To(Succeed())

			Expect(cached()).To(ConsistOf("2.json"))
			Expect(filepath.Join(cacheDir, fetch.MetaFile)).NotTo(BeAnExistingFile(),
				"the default since is the window start, earlier than --since")
			Expect(stderr.String()).To(ContainSubstring(`"msg":"coverage mark not advanced"`))
		})

		It("walks with --full though data/meta.json is malformed, never reading it", func() {
			Expect(os.WriteFile(filepath.Join(dataDir, "meta.json"), []byte(`{"fetched_through":"yesterday"}`), 0o600)).To(Succeed())

			Expect(run("--full")).To(Succeed())

			Expect(cached()).To(ConsistOf("1.json", "2.json"))
			Expect(filepath.Join(cacheDir, fetch.MetaFile)).To(BeAnExistingFile())
		})

		Context("when the cache holds an entry of an older format", func() {
			BeforeEach(func() {
				Expect(os.WriteFile(filepath.Join(dataDir, "meta.json"),
					[]byte(`{"fetched_through":"2026-11-14T12:00:00Z"}`), 0o600)).To(Succeed())
				b, err := json.Marshal(closedPR(1, time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)))
				Expect(err).NotTo(HaveOccurred())
				Expect(os.MkdirAll(filepath.Join(cacheDir, fetch.RawDir), 0o750)).To(Succeed())
				Expect(os.WriteFile(filepath.Join(cacheDir, fetch.RawDir, "1.json"), b, 0o600)).To(Succeed())
			})

			It("walks back to the window start without --since, refetching it", func() {
				Expect(run()).To(Succeed())

				Expect(fetch.ReadEntry(cacheDir, 1)).To(HaveField("FormatVersion", fetch.FormatVersion))
				Expect(stderr.String()).To(ContainSubstring(`"msg":"cache holds entries of an older format"`))
			})

			It("walks back only to --since, and warns", func() {
				Expect(run("--since", "2026-11-01T00:00:00Z")).To(Succeed())

				Expect(fetch.ReadEntry(cacheDir, 1)).To(HaveField("FormatVersion", 0))
				Expect(stderr.String()).To(ContainSubstring(`"msg":"cache holds entries of an older format"`))
			})
		})

		DescribeTable("writes the cache's meta.json only when the walk covers the default range",
			func(written bool, args ...string) {
				Expect(os.WriteFile(filepath.Join(dataDir, "meta.json"),
					[]byte(`{"fetched_through":"2026-11-14T12:00:00Z"}`), 0o600)).To(Succeed())

				Expect(run(args...)).To(Succeed())

				meta := filepath.Join(cacheDir, fetch.MetaFile)
				if written {
					Expect(meta).To(BeAnExistingFile())
				} else {
					Expect(meta).NotTo(BeAnExistingFile())
					Expect(stderr.String()).To(ContainSubstring(`"msg":"coverage mark not advanced"`))
				}
			},
			Entry("without --since", true),
			Entry("with --full", true, "--full"),
			Entry("with a --since before the default", true, "--since", "2026-11-01T00:00:00Z"),
			Entry("with a --since later than the default", false, "--since", "2026-11-14T00:00:00Z"),
		)

		It("rejects a --since when data/meta.json cannot be read, before any request", func() {
			path := filepath.Join(dataDir, "meta.json")
			Expect(os.WriteFile(path, []byte(`{"fetched_through":"yesterday"}`), 0o600)).To(Succeed())

			Expect(run("--since", "2026-11-01T00:00:00Z")).To(MatchError(ContainSubstring(path)))
			Expect(server.Requests()).To(BeEmpty())
		})

		// The host is under .invalid, so a regression fails at name
		// resolution rather than reaching anyone.
		It("refuses a plain-http --api-url to a host that is not loopback, saying why", func() {
			err := run("--api-url", "http://api.example.invalid/graphql")

			Expect(err).To(MatchError("API URL http://api.example.invalid/graphql: scheme must be https, or http to a loopback host, so that the token is not sent in clear text"))
		})

		It("rejects a --since that is not RFC 3339", func() {
			Expect(run("--since", "2026-11-01")).To(MatchError(ContainSubstring("--since")))
			Expect(server.Requests()).To(BeEmpty())
		})

		DescribeTable("fetches again a pull request cached at the same updatedAt only when asked to refetch",
			func(env, title string, args ...string) {
				Expect(run()).To(Succeed())
				server.Update(2, func(e *fetch.Entry) { e.Title = "retitled without moving updatedAt" })
				if env != "" {
					GinkgoT().Setenv("ROOKSTATS_REFETCH", env)
				}

				Expect(run(args...)).To(Succeed())

				Expect(fetch.ReadEntry(cacheDir, 2)).To(HaveField("Title", title))
			},
			Entry("neither the flag nor the environment", "", "pr"),
			Entry("--refetch", "", "retitled without moving updatedAt", "--refetch"),
			Entry("ROOKSTATS_REFETCH=true", "true", "retitled without moving updatedAt"),
			Entry("ROOKSTATS_REFETCH=false", "false", "pr"),
		)

		It("rejects --since with --full", func() {
			Expect(run("--full", "--since", "2026-11-01T00:00:00Z")).To(MatchError("--since and --full are mutually exclusive"))
		})

		// The data and the cache are as a refresh of a later window left
		// them, with baselines in a bare map that records no window.
		It("walks the whole window and asks every baseline again when the data is of a later window, so extract counts standing once", func() {
			later := time.Date(2026, 5, 20, 0, 0, 0, 0, time.UTC)
			Expect(later.After(fetch.WindowStart)).To(BeTrue(), "the data's window must start after the window in force")
			Expect(os.WriteFile(filepath.Join(dataDir, "meta.json"), []byte(`{"repo":"rook/rook","window_start":"`+
				later.Format(time.RFC3339)+`","fetched_through":"2026-11-14T12:00:00Z","github_counts":{"opened_in_window":1,"open":0}}`), 0o600)).To(Succeed())
			Expect(os.WriteFile(filepath.Join(dataDir, "authors.json"), []byte(`{"alice": 5}`), 0o600)).To(Succeed())
			Expect(os.WriteFile(filepath.Join(cacheDir, "authors.json"), []byte(`{"alice": 5}`), 0o600)).To(Succeed())
			server.SetCounts(2, map[string]int{"alice": 0})

			Expect(run()).To(Succeed())
			Expect(cli.Run(context.Background(), []string{"extract", "--cache-dir", cacheDir, "--data", dataDir},
				&bytes.Buffer{}, &bytes.Buffer{}, stderr)).To(Succeed())

			Expect(cached()).To(ConsistOf("1.json", "2.json"), "PR 1, last updated months before the last walk, is fetched")
			b, err := os.ReadFile(filepath.Join(dataDir, "authors.json"))
			Expect(err).NotTo(HaveOccurred())
			Expect(b).To(MatchJSON(`{"alice": 0}`))
			Expect(record.ReadMeta(dataDir)).To(HaveField("WindowStart", fetch.WindowStart))
			prior := map[int]*int{}
			for _, month := range []string{"2026-05", "2026-11"} {
				f, err := os.ReadFile(filepath.Join(dataDir, "prs", month+".jsonl"))
				Expect(err).NotTo(HaveOccurred())
				var rec struct {
					Number   int  `json:"number"`
					PriorPRs *int `json:"prior_prs"`
				}
				Expect(json.Unmarshal(f, &rec)).To(Succeed())
				prior[rec.Number] = rec.PriorPRs
			}
			Expect(prior).To(Equal(map[int]*int{1: new(0), 2: new(1)}))
		})

		It("credits a deleted account's pull request to its commits' committer through fetch, extract and rollup, and no one else's", func() {
			for _, name := range []string{tables.ToolsFile, tables.BotsFile, tables.CommandsFile, tables.LabelsFile, tables.KindsFile} {
				b, err := os.ReadFile(filepath.Join("..", "..", "data", name))
				Expect(err).NotTo(HaveOccurred())
				Expect(os.WriteFile(filepath.Join(dataDir, name), b, 0o600)).To(Succeed())
			}
			at := time.Date(2026, 11, 10, 0, 0, 0, 0, time.UTC)
			commit := fetch.Commit{OID: "1111111111111111111111111111111111111111", AuthoredDate: at.Add(-3 * time.Hour), CommittedDate: at.Add(-2 * time.Hour), Message: "osd: fix a leak\n"}
			deleted := closedPR(3, at)
			deleted.Author = nil
			deleted.Commits = []fetch.Commit{commit}
			deleted.Comments = []fetch.Comment{{CreatedAt: at.Add(-30 * time.Minute), Body: "thanks"}}
			deleted.CommitNames = &fetch.CommitNames{Commits: []fetch.CommitName{{OID: commit.OID, Author: "Kim Example", Committer: "Ivy Example"}}}
			live := closedPR(1, at.Add(-time.Hour))
			live.Commits = []fetch.Commit{commit}
			live.CommitNames = &fetch.CommitNames{Commits: []fetch.CommitName{{OID: commit.OID, Author: "Lee Example", Committer: "Lee Example"}}}
			server = fetchtest.NewServer(live, deleted)
			DeferCleanup(server.Close)
			server.SetCounts(2, map[string]int{"alice": 0})
			outDir := GinkgoT().TempDir()

			Expect(run()).To(Succeed())
			Expect(cli.Run(context.Background(), []string{"extract", "--cache-dir", cacheDir, "--data", dataDir},
				&bytes.Buffer{}, &bytes.Buffer{}, stderr)).To(Succeed())
			Expect(cli.Run(context.Background(), []string{"rollup", "--data", dataDir, "--out", outDir},
				&bytes.Buffer{}, &bytes.Buffer{}, stderr)).To(Succeed())

			records, err := os.ReadFile(filepath.Join(dataDir, "prs", "2026-11.jsonl"))
			Expect(err).NotTo(HaveOccurred())
			Expect(string(records)).To(ContainSubstring(`"number":3,`))
			Expect(string(records)).To(ContainSubstring(`"author":{"login":"ghost","bot":false,"name":"Ivy Example"}`))
			Expect(string(records)).NotTo(ContainSubstring("Lee Example"))
			var meta struct {
				People        []string `json:"people"`
				PeopleDeleted []int    `json:"people_deleted"`
			}
			b, err := os.ReadFile(filepath.Join(outDir, "meta.json"))
			Expect(err).NotTo(HaveOccurred())
			Expect(json.Unmarshal(b, &meta)).To(Succeed())
			Expect(meta.People).To(Equal([]string{"alice", "ghost:Ivy Example", "ghost"}))
			Expect(meta.PeopleDeleted).To(Equal([]int{1}))
			var prs struct {
				Number []int `json:"number"`
				Author []int `json:"author"`
			}
			b, err = os.ReadFile(filepath.Join(outDir, "prs-2026.json"))
			Expect(err).NotTo(HaveOccurred())
			Expect(json.Unmarshal(b, &prs)).To(Succeed())
			Expect(prs.Number).To(Equal([]int{1, 3}))
			Expect(prs.Author).To(Equal([]int{0, 1}))
		})

		// The server's repository was created at the window start and its
		// search counts one pull request fewer than it holds, as GitHub's
		// search has been seen to do.
		It("counts the window by the listing when it starts at the repository's creation, and the source reaches check through data/meta.json", func() {
			for _, name := range []string{tables.ToolsFile, tables.BotsFile, tables.CommandsFile, tables.LabelsFile, tables.KindsFile} {
				b, err := os.ReadFile(filepath.Join("..", "..", "data", name))
				Expect(err).NotTo(HaveOccurred())
				Expect(os.WriteFile(filepath.Join(dataDir, name), b, 0o600)).To(Succeed())
			}
			server.SetCounts(1, map[string]int{"alice": 0})

			Expect(run()).To(Succeed())
			Expect(cli.Run(context.Background(), []string{"extract", "--cache-dir", cacheDir, "--data", dataDir},
				&bytes.Buffer{}, &bytes.Buffer{}, stderr)).To(Succeed())
			stdout := &bytes.Buffer{}
			Expect(cli.Run(context.Background(), []string{"check", "--data", dataDir, "--report"},
				&bytes.Buffer{}, stdout, stderr)).To(Succeed())

			Expect(record.ReadMeta(dataDir)).To(HaveField("GitHubCounts", record.Counts{
				OpenedInWindow: 2, OpenedInWindowSource: record.SourceListing, Open: 0,
			}))
			Expect(stdout.String()).To(HavePrefix("Counts: 2 opened in the window (GitHub's listing: 2), 0 open (GitHub's listing: 0)\n"))
		})
	})
})

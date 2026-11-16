package cli_test

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/jhoblitt/rook-dev-stats/internal/cli"
	"github.com/jhoblitt/rook-dev-stats/internal/fetch"
	"github.com/jhoblitt/rook-dev-stats/internal/record"
)

var _ = Describe("extract", func() {
	var (
		stderr   *bytes.Buffer
		cacheDir string
		dataDir  string
	)

	writeJSON := func(path string, v any) {
		GinkgoHelper()
		b, err := json.Marshal(v)
		Expect(err).NotTo(HaveOccurred())
		Expect(os.MkdirAll(filepath.Dir(path), 0o750)).To(Succeed())
		Expect(os.WriteFile(path, b, 0o600)).To(Succeed())
	}

	BeforeEach(func() {
		stderr = &bytes.Buffer{}
		cacheDir = GinkgoT().TempDir()
		dataDir = GinkgoT().TempDir()
		opened := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
		writeJSON(filepath.Join(cacheDir, fetch.RawDir, "7.json"), fetch.Entry{
			Number: 7, Title: "pr", State: "OPEN", CreatedAt: opened, UpdatedAt: opened,
			BaseRefName: "main", Author: &fetch.Actor{Login: "alice", Typename: "User"},
			FormatVersion: fetch.FormatVersion,
		})
		writeJSON(filepath.Join(cacheDir, "authors.json"), map[string]any{"window_start": fetch.WindowStart, "authors": map[string]int{"alice": 2}})
		writeJSON(filepath.Join(cacheDir, "meta.json"), map[string]any{"window_start": fetch.WindowStart, "walk_started": time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC)})
	})

	run := func(args ...string) error {
		args = append([]string{"extract", "--cache-dir", cacheDir, "--data", dataDir}, args...)
		return cli.Run(context.Background(), args, &bytes.Buffer{}, &bytes.Buffer{}, stderr)
	}

	It("writes the records, authors and meta from the cache", func() {
		Expect(run()).To(Succeed())

		recs, err := record.ReadRecords(dataDir)
		Expect(err).NotTo(HaveOccurred())
		Expect(recs).To(HaveLen(1))
		Expect(recs[0].PriorPRs).To(HaveValue(Equal(2)))
		Expect(record.ReadMeta(dataDir)).To(HaveField("FetchedThrough", time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC)))
		Expect(stderr.String()).To(ContainSubstring(`"msg":"extract finished"`))
	})

	It("re-derives a record from its entry at the same updatedAt, leaving identical bytes", func() {
		Expect(run()).To(Succeed())
		path := filepath.Join(dataDir, record.PRsDir, "2026-06.jsonl")
		before, err := os.ReadFile(path)
		Expect(err).NotTo(HaveOccurred())
		stderr.Reset()

		Expect(run()).To(Succeed())

		Expect(os.ReadFile(path)).To(Equal(before))
		Expect(stderr.String()).To(ContainSubstring(`"replaced":1`))
	})
})

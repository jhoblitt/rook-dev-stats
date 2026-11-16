package cli_test

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/jhoblitt/rook-dev-stats/internal/cli"
	"github.com/jhoblitt/rook-dev-stats/internal/tables"
)

var _ = Describe("rollup", func() {
	var (
		stderr *bytes.Buffer
		outDir string
	)

	BeforeEach(func() {
		stderr = &bytes.Buffer{}
		outDir = filepath.Join(GinkgoT().TempDir(), "public", "data")
	})

	run := func(dataDir string) error {
		args := []string{"rollup", "--data", dataDir, "--out", outDir}
		return cli.Run(context.Background(), args, &bytes.Buffer{}, &bytes.Buffer{}, stderr)
	}

	names := func(dir string) []string {
		GinkgoHelper()
		entries, err := os.ReadDir(dir)
		Expect(err).NotTo(HaveOccurred())
		var out []string
		for _, e := range entries {
			out = append(out, e.Name())
		}
		return out
	}

	It("writes the site's data from the records, tables, tickets and meta", func() {
		dataDir := filepath.Join("..", "rollup", "testdata", "data")
		golden := filepath.Join("..", "rollup", "testdata", "golden")

		Expect(run(dataDir)).To(Succeed())

		Expect(names(outDir)).To(Equal(names(golden)))
		for _, n := range names(golden) {
			want, err := os.ReadFile(filepath.Join(golden, n))
			Expect(err).NotTo(HaveOccurred())
			Expect(os.ReadFile(filepath.Join(outDir, n))).To(Equal(want), n)
		}
		Expect(stderr.String()).To(ContainSubstring(`"msg":"rollup finished"`))
		Expect(stderr.String()).To(ContainSubstring(`"records":9`))
		Expect(stderr.String()).To(ContainSubstring(`"written":8`))
	})

	It("writes an empty dataset from the seed tables alone, removing a stale year", func() {
		dataDir := GinkgoT().TempDir()
		for _, name := range []string{tables.ToolsFile, tables.BotsFile, tables.CommandsFile, tables.LabelsFile, tables.KindsFile} {
			b, err := os.ReadFile(filepath.Join("..", "..", "data", name))
			Expect(err).NotTo(HaveOccurred())
			Expect(os.WriteFile(filepath.Join(dataDir, name), b, 0o600)).To(Succeed())
		}
		Expect(os.MkdirAll(outDir, 0o750)).To(Succeed())
		Expect(os.WriteFile(filepath.Join(outDir, "prs-2025.json"), []byte("{}"), 0o600)).To(Succeed())

		Expect(run(dataDir)).To(Succeed())

		Expect(names(outDir)).To(Equal([]string{"index.json", "meta.json"}))
		b, err := os.ReadFile(filepath.Join(outDir, "meta.json"))
		Expect(err).NotTo(HaveOccurred())
		var meta struct {
			Years []int `json:"years"`
		}
		Expect(json.Unmarshal(b, &meta)).To(Succeed())
		Expect(meta.Years).To(BeEmpty())
		Expect(stderr.String()).To(ContainSubstring(`"removed":1`))
	})

	It("fails on a broken table, naming it, and writes nothing", func() {
		dataDir := GinkgoT().TempDir()
		Expect(os.WriteFile(filepath.Join(dataDir, tables.CommandsFile), []byte("comands: []\n"), 0o600)).To(Succeed())

		Expect(run(dataDir)).To(MatchError(ContainSubstring(filepath.Join(dataDir, tables.CommandsFile))))
		Expect(outDir).NotTo(BeADirectory())
	})
})

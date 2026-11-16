package rollup_test

import (
	"os"
	"path/filepath"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/jhoblitt/rook-dev-stats/internal/rollup"
)

var _ = Describe("Write", func() {
	var dir string

	BeforeEach(func() {
		dir = filepath.Join(GinkgoT().TempDir(), "site", "data")
	})

	files := func(names ...string) []rollup.File {
		var fs []rollup.File
		for _, n := range names {
			fs = append(fs, rollup.File{Name: n, Data: []byte(`{"name":"` + n + `"}`)})
		}
		return fs
	}

	read := func(name string) string {
		GinkgoHelper()
		b, err := os.ReadFile(filepath.Join(dir, name))
		Expect(err).NotTo(HaveOccurred())
		return string(b)
	}

	stat := func(name string) os.FileInfo {
		GinkgoHelper()
		fi, err := os.Stat(filepath.Join(dir, name))
		Expect(err).NotTo(HaveOccurred())
		return fi
	}

	It("creates the directory and writes every file", func() {
		res, err := rollup.Write(dir, files("meta.json", "index.json", "prs-2026.json"))
		Expect(err).NotTo(HaveOccurred())
		Expect(res.Written).To(Equal([]string{"meta.json", "index.json", "prs-2026.json"}))
		Expect(res.Removed).To(BeEmpty())
		Expect(read("index.json")).To(Equal(`{"name":"index.json"}`))
		Expect(read("prs-2026.json")).To(Equal(`{"name":"prs-2026.json"}`))
	})

	It("names the files it wrote in the order they were given", func() {
		res, err := rollup.Write(dir, files("table-2026.json", "meta.json", "events-2026.json"))
		Expect(err).NotTo(HaveOccurred())
		Expect(res.Written).To(Equal([]string{"table-2026.json", "meta.json", "events-2026.json"}))
	})

	It("rewrites only the files whose bytes change, and leaves no temporary file", func() {
		_, err := rollup.Write(dir, files("meta.json", "prs-2026.json"))
		Expect(err).NotTo(HaveOccurred())
		before := stat("meta.json")

		changed := files("meta.json", "prs-2026.json")
		changed[1].Data = []byte(`{"changed":true}`)
		res, err := rollup.Write(dir, changed)
		Expect(err).NotTo(HaveOccurred())
		Expect(res.Written).To(Equal([]string{"prs-2026.json"}))
		Expect(os.SameFile(before, stat("meta.json"))).To(BeTrue(), "meta.json was replaced")
		Expect(read("prs-2026.json")).To(Equal(`{"changed":true}`))

		res, err = rollup.Write(dir, changed)
		Expect(err).NotTo(HaveOccurred())
		Expect(res.Written).To(BeEmpty())

		entries, err := os.ReadDir(dir)
		Expect(err).NotTo(HaveOccurred())
		Expect(entries).To(HaveLen(2))
	})

	It("removes the rollup's files it did not write, and nothing else", func() {
		Expect(os.MkdirAll(dir, 0o750)).To(Succeed())
		for _, n := range []string{
			"prs-2024.json", "events-2024.json", "table-2024.json", ".prs-2024.json.123.tmp", ".index.json.456.tmp",
			"notes.txt", "prs-2024.json.bak", "favicon.svg", "prs-latest.json",
		} {
			Expect(os.WriteFile(filepath.Join(dir, n), []byte("x"), 0o600)).To(Succeed())
		}
		res, err := rollup.Write(dir, files("meta.json"))
		Expect(err).NotTo(HaveOccurred())
		Expect(res.Removed).To(Equal([]string{
			".index.json.456.tmp", ".prs-2024.json.123.tmp", "events-2024.json", "prs-2024.json", "table-2024.json",
		}))
		entries, err := os.ReadDir(dir)
		Expect(err).NotTo(HaveOccurred())
		var left []string
		for _, e := range entries {
			left = append(left, e.Name())
		}
		Expect(left).To(ConsistOf("meta.json", "notes.txt", "prs-2024.json.bak", "favicon.svg", "prs-latest.json"))
	})

	It("refuses a file name that is not the rollup's", func() {
		_, err := rollup.Write(dir, files("../escape.json"))
		Expect(err).To(MatchError(ContainSubstring(`"../escape.json"`)))
	})
})

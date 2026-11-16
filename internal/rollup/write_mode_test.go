//go:build unix

// Permission bits and the umask are Unix concepts, so these specs are too.

package rollup_test

import (
	"os"
	"path/filepath"
	"syscall"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/jhoblitt/rook-dev-stats/internal/rollup"
)

var _ = Describe("Write's permissions", func() {
	const (
		public     = "-rw-r--r--"
		publicDir  = "drwxr-xr-x"
		privateDir = "drwxr-x---"
	)

	var root, dir string

	// root stands for a directory the operator already has, given a mode
	// Write must not change.
	BeforeEach(func() {
		root = GinkgoT().TempDir()
		Expect(os.Chmod(root, 0o750)).To(Succeed())
		dir = filepath.Join(root, "site", "data")
	})

	files := func(names ...string) []rollup.File {
		var fs []rollup.File
		for _, n := range names {
			fs = append(fs, rollup.File{Name: n, Data: []byte(`{"name":"` + n + `"}`)})
		}
		return fs
	}

	mode := func(path string) string {
		GinkgoHelper()
		fi, err := os.Stat(path)
		Expect(err).NotTo(HaveOccurred())
		return fi.Mode().String()
	}

	// modes maps every entry of dir to its mode, so a failure names each
	// file whose mode is wrong.
	modes := func() map[string]string {
		GinkgoHelper()
		entries, err := os.ReadDir(dir)
		Expect(err).NotTo(HaveOccurred())
		got := map[string]string{}
		for _, e := range entries {
			got[e.Name()] = mode(filepath.Join(dir, e.Name()))
		}
		return got
	}

	expectPublic := func() {
		GinkgoHelper()
		Expect(modes()).To(Equal(map[string]string{
			"meta.json": public, "index.json": public, "prs-2026.json": public, "events-2026.json": public,
		}))
		Expect(mode(dir)).To(Equal(publicDir), "the output directory")
		Expect(mode(filepath.Dir(dir))).To(Equal(publicDir), "the output directory's parent, which Write also created")
		Expect(mode(root)).To(Equal(privateDir), "the existing directory above the ones Write created")
	}

	It("writes every file readable by everyone and creates its directories listable by everyone", func() {
		_, err := rollup.Write(dir, files("meta.json", "index.json", "prs-2026.json", "events-2026.json"))
		Expect(err).NotTo(HaveOccurred())
		expectPublic()
	})

	// The umask belongs to the whole process. Ginkgo runs one spec at a time
	// in a process and its parallel workers are separate processes, so no
	// other spec sees this one's umask; Serial runs it with no other worker
	// running at all, so that holds even if that model changes.
	It("does so whatever the umask", Serial, func() {
		old := syscall.Umask(0o077)
		DeferCleanup(func() { syscall.Umask(old) })

		_, err := rollup.Write(dir, files("meta.json", "index.json", "prs-2026.json", "events-2026.json"))
		Expect(err).NotTo(HaveOccurred())
		expectPublic()
	})

	It("leaves every file readable by everyone after a second run over its output", func() {
		_, err := rollup.Write(dir, files("meta.json", "index.json", "prs-2026.json", "events-2026.json"))
		Expect(err).NotTo(HaveOccurred())

		changed := files("meta.json", "index.json", "prs-2026.json", "events-2026.json")
		changed[2].Data = []byte(`{"changed":true}`)
		res, err := rollup.Write(dir, changed)
		Expect(err).NotTo(HaveOccurred())
		Expect(res.Written).To(Equal([]string{"prs-2026.json"}))
		expectPublic()
	})

	It("makes a file an earlier version left readable by its owner only readable by everyone, without rewriting it", func() {
		Expect(os.MkdirAll(dir, 0o750)).To(Succeed())
		Expect(os.Chmod(dir, 0o750)).To(Succeed())
		dirBefore := mode(dir)
		f := files("meta.json")[0]
		path := filepath.Join(dir, f.Name)
		Expect(os.WriteFile(path, f.Data, 0o600)).To(Succeed())
		Expect(os.Chmod(path, 0o600)).To(Succeed())
		before, err := os.Stat(path)
		Expect(err).NotTo(HaveOccurred())

		res, err := rollup.Write(dir, []rollup.File{f})
		Expect(err).NotTo(HaveOccurred())
		Expect(res.Written).To(BeEmpty())
		after, err := os.Stat(path)
		Expect(err).NotTo(HaveOccurred())
		Expect(os.SameFile(before, after)).To(BeTrue(), "meta.json was replaced")
		Expect(after.Mode().String()).To(Equal(public))
		Expect(mode(dir)).To(Equal(dirBefore), "the output directory, which already existed")
		Expect(mode(root)).To(Equal(privateDir), "the existing directory above it")
	})
})

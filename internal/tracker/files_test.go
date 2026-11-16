package tracker_test

import (
	"os"
	"path/filepath"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/jhoblitt/ceph-dev-stats/internal/tracker"
)

var _ = Describe("tickets.json", func() {
	var dataDir string

	BeforeEach(func() {
		dataDir = GinkgoT().TempDir()
	})

	path := func() string { return filepath.Join(dataDir, tracker.File) }

	It("writes one ticket a line, in numeric order, and reads them back", func() {
		tickets := map[int]tracker.Ticket{
			100:   {Type: "Backport", Parent: 9},
			9:     {Type: "Bug"},
			10:    {},
			77766: {Type: "Working Group"},
		}

		Expect(tracker.Write(dataDir, tickets)).To(BeTrue())

		b, err := os.ReadFile(path())
		Expect(err).NotTo(HaveOccurred())
		Expect(string(b)).To(Equal(`{
  "9": {"type":"Bug"},
  "10": {"type":""},
  "100": {"type":"Backport","parent":9},
  "77766": {"type":"Working Group"}
}
`))
		Expect(tracker.Read(dataDir)).To(Equal(tickets))
	})

	It("leaves an unchanged file alone", func() {
		tickets := map[int]tracker.Ticket{9: {Type: "Bug"}}
		Expect(tracker.Write(dataDir, tickets)).To(BeTrue())

		Expect(tracker.Write(dataDir, tickets)).To(BeFalse())
	})

	It("writes an empty object for no tickets", func() {
		Expect(tracker.Write(dataDir, nil)).To(BeTrue())

		Expect(os.ReadFile(path())).To(Equal([]byte("{}\n")))
	})

	It("reads no tickets when there is no file", func() {
		Expect(tracker.Read(dataDir)).To(BeEmpty())
	})

	It("is an error naming the file when it is malformed", func() {
		Expect(os.WriteFile(path(), []byte(`{"x": {"type": "Bug"}}`), 0o600)).To(Succeed())

		_, err := tracker.Read(dataDir)

		Expect(err).To(MatchError(ContainSubstring(path())))
	})
})

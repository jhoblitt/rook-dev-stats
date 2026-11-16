package record_test

import (
	"path/filepath"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/jhoblitt/rook-dev-stats/internal/record"
)

var _ = Describe("kind hints", func() {
	var dataDir string

	BeforeEach(func() {
		dataDir = GinkgoT().TempDir()
	})

	month := func() string {
		return filepath.Join(dataDir, record.PRsDir, "2026-06.jsonl")
	}

	It("writes kind_hints last, its keys in order, and reads it back", func() {
		r := minimal(1, "2026-06-01T00:00:00Z")
		r.KindHints = &record.KindHints{
			Issues: []record.Issue{
				{Number: 16002, Repository: "rook/rook", Labels: []string{"bug", "csi"}},
				{Number: 4001, Repository: "ceph/ceph-csi"},
			},
			BackportOf: 15001,
		}
		Expect(record.WriteRecords(dataDir, []record.Record{r})).Error().NotTo(HaveOccurred())

		Expect(readFile(month())).To(HaveSuffix(
			`"commit_prose":[]},"kind_hints":{"issues":[` +
				`{"number":16002,"repository":"rook/rook","labels":["bug","csi"]},` +
				`{"number":4001,"repository":"ceph/ceph-csi"}],"backport_of":15001}}` + "\n"))
		Expect(record.ReadRecords(dataDir)).To(ConsistOf(r))
	})

	It("leaves out each empty hint", func() {
		r := minimal(1, "2026-06-01T00:00:00Z")
		r.KindHints = &record.KindHints{BackportOf: 15001}
		Expect(record.WriteRecords(dataDir, []record.Record{r})).Error().NotTo(HaveOccurred())

		Expect(readFile(month())).To(HaveSuffix(`"kind_hints":{"backport_of":15001}}` + "\n"))
	})

	It("leaves out kind_hints when there is no hint", func() {
		Expect(record.WriteRecords(dataDir, []record.Record{minimal(1, "2026-06-01T00:00:00Z")})).Error().NotTo(HaveOccurred())

		Expect(readFile(month())).NotTo(ContainSubstring("kind_hints"))
	})
})

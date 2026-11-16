package cli_test

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/jhoblitt/rook-dev-stats/internal/cli"
	"github.com/jhoblitt/rook-dev-stats/internal/record"
	"github.com/jhoblitt/rook-dev-stats/internal/tracker"
)

var _ = Describe("tickets", func() {
	var (
		stderr  *bytes.Buffer
		dataDir string
		server  *httptest.Server
		mu      sync.Mutex
		types   map[string]string
		queries []string
	)

	BeforeEach(func() {
		stderr = &bytes.Buffer{}
		dataDir = GinkgoT().TempDir()
		types = map[string]string{"90001": "Bug"}
		queries = nil
		server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mu.Lock()
			defer mu.Unlock()
			queries = append(queries, r.URL.RawQuery)
			issues := "[]"
			if typ, ok := types[r.URL.Query().Get("issue_id")]; ok {
				issues = fmt.Sprintf(`[{"id":%s,"tracker":{"id":1,"name":%q}}]`, r.URL.Query().Get("issue_id"), typ)
			}
			fmt.Fprintf(w, `{"issues":%s,"total_count":0,"offset":0,"limit":100}`, issues)
		}))
		DeferCleanup(server.Close)

		created := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
		_, err := record.WriteRecords(dataDir, []record.Record{{
			Number: 1, Created: created, Updated: created, State: record.StateOpen,
			KindHints: &record.KindHints{Tickets: []int{90001}},
		}})
		Expect(err).NotTo(HaveOccurred())
	})

	run := func(args ...string) error {
		args = append([]string{"tickets", "--data", dataDir, "--tracker-url", server.URL}, args...)
		return cli.Run(context.Background(), args, &bytes.Buffer{}, &bytes.Buffer{}, stderr)
	}

	It("saves the type of each ticket the records reference", func() {
		Expect(run()).To(Succeed())

		Expect(tracker.Read(dataDir)).To(Equal(map[int]tracker.Ticket{90001: {Type: "Bug"}}))
		Expect(stderr.String()).To(ContainSubstring(`"msg":"tickets finished"`))
	})

	It("asks again for a ticket of unknown type only with --refresh", func() {
		delete(types, "90001")
		Expect(run()).To(Succeed())
		Expect(tracker.Read(dataDir)).To(HaveKeyWithValue(90001, tracker.Ticket{}))

		mu.Lock()
		types["90001"] = "Feature"
		mu.Unlock()
		Expect(run()).To(Succeed())
		Expect(run("--refresh")).To(Succeed())

		mu.Lock()
		defer mu.Unlock()
		Expect(queries).To(HaveLen(2))
		Expect(tracker.Read(dataDir)).To(HaveKeyWithValue(90001, tracker.Ticket{Type: "Feature"}))
	})

	It("refuses a tracker URL with credentials, without repeating them", func() {
		err := cli.Run(context.Background(),
			[]string{"tickets", "--data", dataDir, "--tracker-url", "https://someone:s3cr3t@tracker.example.com"},
			&bytes.Buffer{}, &bytes.Buffer{}, stderr)

		Expect(err).To(MatchError(ContainSubstring("must not carry")))
		Expect(err.Error()).NotTo(ContainSubstring("s3cr3t"))
	})
})

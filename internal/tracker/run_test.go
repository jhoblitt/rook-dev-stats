package tracker_test

import (
	"context"
	"net/http/httptest"
	"path/filepath"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/jhoblitt/ceph-dev-stats/internal/record"
	"github.com/jhoblitt/ceph-dev-stats/internal/tracker"
)

var _ = Describe("Run", func() {
	var (
		clock   *fakeClock
		fake    *fakeTracker
		server  *httptest.Server
		dataDir string
	)

	BeforeEach(func() {
		clock = newFakeClock()
		fake = newFakeTracker(clock)
		server = httptest.NewServer(fake)
		DeferCleanup(server.Close)
		dataDir = GinkgoT().TempDir()
	})

	// writeRecords commits one record for each list of tickets.
	writeRecords := func(tickets ...[]int) {
		GinkgoHelper()
		recs := make([]record.Record, len(tickets))
		for i, ts := range tickets {
			created := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
			recs[i] = record.Record{
				Number: i + 1, Created: created, Updated: created, State: record.StateOpen,
				Labels: []string{}, Events: []record.Event{}, Reviews: []record.Review{}, Comments: []record.Comment{},
			}
			if len(ts) > 0 {
				recs[i].KindHints = &record.KindHints{Tickets: ts}
			}
		}
		Expect(record.WriteRecords(dataDir, recs)).Error().NotTo(HaveOccurred())
	}

	run := func(refresh bool) error {
		c, err := tracker.NewClient(server.URL, tracker.WithClock(clock), tracker.WithHTTPClient(server.Client()), tracker.WithLogger(quiet()))
		Expect(err).NotTo(HaveOccurred())
		return tracker.Run(context.Background(), c, tracker.Config{DataDir: dataDir, Refresh: refresh, Logger: quiet()})
	}

	saved := func() map[int]tracker.Ticket {
		GinkgoHelper()
		t, err := tracker.Read(dataDir)
		Expect(err).NotTo(HaveOccurred())
		return t
	}

	idsPerRequest := func() []int {
		var n []int
		for _, r := range fake.seen() {
			n = append(n, len(r.IDs))
		}
		return n
	}

	idsOfRequests := func() [][]int {
		var ids [][]int
		for _, r := range fake.seen() {
			ids = append(ids, r.IDs)
		}
		return ids
	}

	// unknown is n tickets from 90000 on, each a Bug to the fake tracker,
	// referenced by records of ten tickets each.
	unknown := func(n int) []int {
		ids := make([]int, n)
		var recs [][]int
		for i := range ids {
			ids[i] = 90000 + i
			fake.add(ids[i], "Bug")
			if i%10 == 0 {
				recs = append(recs, nil)
			}
			recs[len(recs)-1] = append(recs[len(recs)-1], ids[i])
		}
		writeRecords(recs...)
		return ids
	}

	It("asks for 250 unknown tickets in three requests of at most 100, and for none on a second run", func() {
		ids := unknown(250)

		Expect(run(false)).To(Succeed())

		Expect(idsPerRequest()).To(Equal([]int{100, 100, 50}))
		Expect(fake.seen()[0].IDs).To(Equal(ids[:100]))
		got := saved()
		Expect(got).To(HaveLen(250))
		Expect(got).To(HaveKeyWithValue(90249, tracker.Ticket{Type: "Bug"}))

		Expect(run(false)).To(Succeed())

		Expect(fake.seen()).To(HaveLen(3))
	})

	It("asks only for the tickets not already saved", func() {
		fake.add(90001, "Bug")
		fake.add(90002, "Feature")
		writeRecords([]int{90001, 90002}, nil)
		Expect(tracker.Write(dataDir, map[int]tracker.Ticket{90001: {Type: "Bug"}})).To(BeTrue())

		Expect(run(false)).To(Succeed())

		Expect(fake.seen()).To(ConsistOf(HaveField("IDs", []int{90002})))
		Expect(saved()).To(Equal(map[int]tracker.Ticket{90001: {Type: "Bug"}, 90002: {Type: "Feature"}}))
	})

	It("records a Backport ticket's parent and asks for the parent in a following request", func() {
		copied := relation{ID: 1, IssueID: 77766, IssueToID: 83186, Type: "copied_to"}
		fake.add(77766, "Enhancement", copied)
		fake.add(83186, "Backport", copied)
		writeRecords([]int{83186})

		Expect(run(false)).To(Succeed())

		reqs := fake.seen()
		Expect(reqs).To(HaveLen(2))
		Expect(reqs[0].IDs).To(Equal([]int{83186}))
		Expect(reqs[1].IDs).To(Equal([]int{77766}))
		Expect(saved()).To(Equal(map[int]tracker.Ticket{
			77766: {Type: "Enhancement"},
			83186: {Type: "Backport", Parent: 77766},
		}))
	})

	It("asks for a saved Backport ticket's parent that is not saved yet", func() {
		fake.add(77766, "Enhancement")
		writeRecords([]int{83186})
		Expect(tracker.Write(dataDir, map[int]tracker.Ticket{83186: {Type: "Backport", Parent: 77766}})).To(BeTrue())

		Expect(run(false)).To(Succeed())

		Expect(fake.seen()).To(ConsistOf(HaveField("IDs", []int{77766})))
		Expect(saved()).To(HaveKeyWithValue(77766, tracker.Ticket{Type: "Enhancement"}))
	})

	It("follows a chain of parents, a Backport of a Backport, one request a link", func() {
		first := relation{ID: 1, IssueID: 77766, IssueToID: 80000, Type: "copied_to"}
		second := relation{ID: 2, IssueID: 80000, IssueToID: 83186, Type: "copied_to"}
		fake.add(77766, "Enhancement", first)
		fake.add(80000, "Backport", first, second)
		fake.add(83186, "Backport", second)
		writeRecords([]int{83186})

		Expect(run(false)).To(Succeed())

		Expect(idsOfRequests()).To(Equal([][]int{{83186}, {80000}, {77766}}))
		Expect(saved()).To(Equal(map[int]tracker.Ticket{
			77766: {Type: "Enhancement"},
			80000: {Type: "Backport", Parent: 77766},
			83186: {Type: "Backport", Parent: 80000},
		}))
	})

	It("gives a parent the tracker omits an empty type, and does not ask for it again", func() {
		fake.add(83186, "Backport", relation{ID: 1, IssueID: 77766, IssueToID: 83186, Type: "copied_to"})
		writeRecords([]int{83186})

		Expect(run(false)).To(Succeed())

		Expect(idsOfRequests()).To(Equal([][]int{{83186}, {77766}}))
		Expect(saved()).To(Equal(map[int]tracker.Ticket{
			77766: {},
			83186: {Type: "Backport", Parent: 77766},
		}))

		Expect(run(false)).To(Succeed())

		Expect(fake.seen()).To(HaveLen(2))
	})

	It("gives a ticket the tracker omits an empty type, skips it next time, and asks again with refresh", func() {
		fake.add(90001, "Bug")
		writeRecords([]int{90001, 90002})

		Expect(run(false)).To(Succeed())

		Expect(saved()).To(Equal(map[int]tracker.Ticket{90001: {Type: "Bug"}, 90002: {}}))

		Expect(run(false)).To(Succeed())

		Expect(fake.seen()).To(HaveLen(1))

		fake.add(90002, "Support")
		Expect(run(true)).To(Succeed())

		reqs := fake.seen()
		Expect(reqs).To(HaveLen(2))
		Expect(reqs[1].IDs).To(Equal([]int{90002}))
		Expect(saved()).To(HaveKeyWithValue(90002, tracker.Ticket{Type: "Support"}))
	})

	It("stops when a request fails four times, keeping the batches saved before it", func() {
		unknown(250)
		fake.failRequests(2, 4)

		err := run(false)

		Expect(err).To(MatchError(ContainSubstring("HTTP 503")))
		Expect(fake.seen()).To(HaveLen(5))
		got := saved()
		Expect(got).To(HaveLen(100))
		Expect(got).To(HaveKey(90000))
		Expect(got).To(HaveKey(90099))
	})

	It("writes nothing when there is nothing to ask for", func() {
		writeRecords(nil)

		Expect(run(false)).To(Succeed())

		Expect(fake.seen()).To(BeEmpty())
		Expect(filepath.Join(dataDir, tracker.File)).NotTo(BeAnExistingFile())
	})
})

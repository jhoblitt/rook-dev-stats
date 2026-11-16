package tracker_test

import (
	"context"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/onsi/gomega/types"

	"github.com/jhoblitt/ceph-dev-stats/internal/tracker"
)

var _ = Describe("Client", func() {
	var (
		clock  *fakeClock
		fake   *fakeTracker
		server *httptest.Server
	)

	BeforeEach(func() {
		clock = newFakeClock()
		fake = newFakeTracker(clock)
		server = httptest.NewServer(fake)
		DeferCleanup(server.Close)
	})

	newClient := func(opts ...tracker.Option) *tracker.Client {
		GinkgoHelper()
		base := []tracker.Option{tracker.WithClock(clock), tracker.WithHTTPClient(server.Client()), tracker.WithLogger(quiet())}
		c, err := tracker.NewClient(server.URL, append(base, opts...)...)
		Expect(err).NotTo(HaveOccurred())
		return c
	}

	It("asks for the tickets in one filtered list, anonymously, naming itself", func() {
		fake.add(90001, "Bug")

		_, err := newClient().Tickets(context.Background(), []int{90003, 90001, 90002})

		Expect(err).NotTo(HaveOccurred())
		reqs := fake.seen()
		Expect(reqs).To(HaveLen(1))
		Expect(reqs[0].Method).To(Equal(http.MethodGet))
		Expect(reqs[0].Path).To(Equal("/issues.json"))
		Expect(reqs[0].Query).To(Equal("issue_id=90001,90002,90003&status_id=*&include=relations&limit=100"))
		Expect(reqs[0].Header.Get("User-Agent")).To(MatchRegexp(`^cephstats/[^\s()/]+$`))
		for _, h := range []string{"Authorization", "Cookie", "X-Redmine-Api-Key", "From"} {
			Expect(reqs[0].Header.Values(h)).To(BeEmpty(), "header %s", h)
		}
	})

	It("sends no cookie, even through an HTTP client with a cookie jar", func() {
		jar, err := cookiejar.New(nil)
		Expect(err).NotTo(HaveOccurred())
		u, err := url.Parse(server.URL)
		Expect(err).NotTo(HaveOccurred())
		jar.SetCookies(u, []*http.Cookie{{Name: "_redmine_session", Value: "someone"}})
		h := server.Client()
		h.Jar = jar

		_, err = newClient(tracker.WithHTTPClient(h)).Tickets(context.Background(), []int{1})

		Expect(err).NotTo(HaveOccurred())
		Expect(fake.seen()).To(ConsistOf(HaveField("Header", Not(HaveKey("Cookie")))))
	})

	It("keeps a base URL's path", func() {
		c, err := tracker.NewClient(server.URL+"/redmine/", tracker.WithClock(clock), tracker.WithHTTPClient(server.Client()))
		Expect(err).NotTo(HaveOccurred())

		_, err = c.Tickets(context.Background(), []int{1})

		Expect(err).NotTo(HaveOccurred())
		Expect(fake.seen()).To(ConsistOf(HaveField("Path", "/redmine/issues.json")))
	})

	DescribeTable("refuses a base URL that is not plain HTTP(S) without credentials",
		func(url string) {
			_, err := tracker.NewClient(url)
			Expect(err).To(MatchError(ContainSubstring("tracker URL")), "url %q", url)
		},
		Entry("credentials in the URL", "https://someone:secret@tracker.example.com"),
		Entry("a user name alone", "https://someone@tracker.example.com"),
		Entry("a query, which could carry an API key", "https://tracker.example.com/?key=abc"),
		Entry("another scheme", "ftp://tracker.example.com"),
		Entry("no host", "https:///issues"),
	)

	It("refuses more than a batch of tickets in one request", func() {
		ids := make([]int, tracker.BatchSize+1)
		for i := range ids {
			ids[i] = i + 1
		}

		_, err := newClient().Tickets(context.Background(), ids)

		Expect(err).To(MatchError(ContainSubstring("101 tickets")))
		Expect(fake.seen()).To(BeEmpty())
	})

	It("gives each ticket the tracker's name for its type, and an empty type to one it does not return", func() {
		fake.add(90001, "Bug")
		fake.add(90002, "QA Run")

		got, err := newClient().Tickets(context.Background(), []int{90001, 90002, 90003})

		Expect(err).NotTo(HaveOccurred())
		Expect(got).To(Equal(map[int]tracker.Ticket{
			90001: {Type: "Bug"},
			90002: {Type: "QA Run"},
			90003: {},
		}))
	})

	It("gives a Backport ticket the ticket it was copied from as its parent, and no other ticket a parent", func() {
		copied := relation{ID: 1, IssueID: 90001, IssueToID: 90002, Type: "copied_to"}
		fake.add(90001, "Enhancement", copied)
		fake.add(90002, "Backport",
			relation{ID: 2, IssueID: 90002, IssueToID: 90009, Type: "relates"},
			// The backport was itself copied onward; that copy is not its parent.
			relation{ID: 4, IssueID: 90002, IssueToID: 90005, Type: "copied_to"},
			copied)
		fake.add(90003, "Bug", relation{ID: 3, IssueID: 90008, IssueToID: 90003, Type: "copied_to"})

		got, err := newClient().Tickets(context.Background(), []int{90001, 90002, 90003})

		Expect(err).NotTo(HaveOccurred())
		Expect(got).To(Equal(map[int]tracker.Ticket{
			90001: {Type: "Enhancement"},
			90002: {Type: "Backport", Parent: 90001},
			90003: {Type: "Bug"},
		}))
	})

	It("sends two requests at least the configured interval apart", func() {
		fake.latency = 250 * time.Millisecond
		c := newClient(tracker.WithInterval(3 * time.Second))

		for range 3 {
			_, err := c.Tickets(context.Background(), []int{1})
			Expect(err).NotTo(HaveOccurred())
		}

		reqs := fake.seen()
		Expect(reqs).To(HaveLen(3))
		Expect(reqs[1].At.Sub(reqs[0].At)).To(BeNumerically(">=", 3*time.Second))
		Expect(reqs[2].At.Sub(reqs[1].At)).To(BeNumerically(">=", 3*time.Second))
	})

	It("never sends two requests less than a second apart, whatever the configured interval", func() {
		c := newClient(tracker.WithInterval(0))

		for range 2 {
			_, err := c.Tickets(context.Background(), []int{1})
			Expect(err).NotTo(HaveOccurred())
		}

		reqs := fake.seen()
		Expect(reqs).To(HaveLen(2))
		Expect(reqs[1].At.Sub(reqs[0].At)).To(BeNumerically(">=", time.Second))
	})

	It("retries a failed request three times, backing off longer each time", func() {
		fake.add(90001, "Bug")
		fake.failRequests(1, 3)

		got, err := newClient().Tickets(context.Background(), []int{90001})

		Expect(err).NotTo(HaveOccurred())
		Expect(got).To(HaveKeyWithValue(90001, tracker.Ticket{Type: "Bug"}))
		Expect(fake.seen()).To(HaveLen(4))
		Expect(clock.sleeps()).To(Equal([]time.Duration{2 * time.Second, 4 * time.Second, 8 * time.Second}))
	})

	// status answers with code and, when retryAfter is not empty, a
	// Retry-After header holding it.
	status := func(code int, retryAfter string) reply {
		return func(w http.ResponseWriter, _ time.Time) {
			if retryAfter != "" {
				w.Header().Set("Retry-After", retryAfter)
			}
			w.WriteHeader(code)
		}
	}

	// retryAt answers with code and a Retry-After header holding the date
	// after on the fake clock.
	retryAt := func(code int, after time.Duration) reply {
		return func(w http.ResponseWriter, now time.Time) {
			w.Header().Set("Retry-After", now.Add(after).UTC().Format(http.TimeFormat))
			w.WriteHeader(code)
		}
	}

	// body answers 200 with b as JSON.
	body := func(b string) reply {
		return func(w http.ResponseWriter, _ time.Time) {
			w.Header().Set("Content-Type", "application/json")
			_, err := w.Write([]byte(b))
			Expect(err).NotTo(HaveOccurred())
		}
	}

	// cutShort promises more of a body than it sends, so reading it fails.
	cutShort := func(w http.ResponseWriter, _ time.Time) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Length", "100")
		_, err := w.Write([]byte(`{"issues": [`))
		Expect(err).NotTo(HaveOccurred())
	}

	DescribeTable("answers each odd reply with the requests, the waits and the outcome it calls for",
		func(rep reply, times, requests int, sleeps []time.Duration, wantErr types.GomegaMatcher) {
			fake.add(90001, "Bug")
			fake.script(1, times, rep)

			got, err := newClient().Tickets(context.Background(), []int{90001})

			if wantErr == nil {
				Expect(err).NotTo(HaveOccurred())
				Expect(got).To(Equal(map[int]tracker.Ticket{90001: {Type: "Bug"}}))
			} else {
				Expect(err).To(wantErr)
			}
			Expect(fake.seen()).To(HaveLen(requests), "requests")
			Expect(clock.sleeps()).To(Equal(sleeps), "sleeps")
		},
		Entry("a 429 without Retry-After keeps the schedule",
			status(http.StatusTooManyRequests, ""), 1, 2, []time.Duration{2 * time.Second}, nil),
		Entry("a 429 with Retry-After in seconds waits that long",
			status(http.StatusTooManyRequests, "60"), 1, 2, []time.Duration{60 * time.Second}, nil),
		Entry("a 429 with Retry-After as a date waits until then",
			retryAt(http.StatusTooManyRequests, 90*time.Second), 1, 2, []time.Duration{90 * time.Second}, nil),
		Entry("a 503 with a Retry-After in seconds shorter than the schedule keeps the schedule",
			status(http.StatusServiceUnavailable, "1"), 2, 3, []time.Duration{2 * time.Second, 4 * time.Second}, nil),
		Entry("a 503 with Retry-After as a date waits until then, each time",
			retryAt(http.StatusServiceUnavailable, 30*time.Second), 3, 4, []time.Duration{30 * time.Second, 30 * time.Second, 30 * time.Second}, nil),
		Entry("a 503 with Retry-After as a date already past keeps the schedule",
			retryAt(http.StatusServiceUnavailable, -time.Hour), 1, 2, []time.Duration{2 * time.Second}, nil),
		Entry("a Retry-After the client cannot read keeps the schedule",
			status(http.StatusTooManyRequests, "soon"), 1, 2, []time.Duration{2 * time.Second}, nil),
		Entry("a Retry-After over five minutes stops the run, saying how long the tracker asked for",
			status(http.StatusTooManyRequests, "301"), 1, 1, []time.Duration{},
			MatchError(And(ContainSubstring("HTTP 429"), ContainSubstring("asked to wait 5m1s")))),
		Entry("a Retry-After in seconds too large to parse is over five minutes too",
			status(http.StatusServiceUnavailable, "99999999999999999999"), 1, 1, []time.Duration{},
			MatchError(And(ContainSubstring("HTTP 503"), ContainSubstring("asked to wait")))),
		// The redirect leads back to the fake, so a client that followed it
		// would contact no other host.
		Entry("a redirect is not followed or retried, and names the host it leads to",
			func(w http.ResponseWriter, _ time.Time) {
				w.Header().Set("Location", "/moved/issues.json")
				w.WriteHeader(http.StatusMovedPermanently)
			}, 1, 1, []time.Duration{},
			MatchError(And(ContainSubstring("HTTP 301"), ContainSubstring("127.0.0.1"), ContainSubstring("tracker URL")))),
		Entry("a read error is retried",
			reply(cutShort), 4, 4, []time.Duration{2 * time.Second, 4 * time.Second, 8 * time.Second},
			MatchError(ContainSubstring("reading tracker answer"))),
		Entry("an empty body is retried",
			body(""), 4, 4, []time.Duration{2 * time.Second, 4 * time.Second, 8 * time.Second},
			MatchError(ContainSubstring("empty tracker answer"))),
		Entry("malformed JSON is retried",
			body(`{"issues": [`), 4, 4, []time.Duration{2 * time.Second, 4 * time.Second, 8 * time.Second},
			MatchError(ContainSubstring("malformed tracker answer"))),
		Entry("null issues are retried",
			body(`{"issues": null, "total_count": 0}`), 4, 4, []time.Duration{2 * time.Second, 4 * time.Second, 8 * time.Second},
			MatchError(ContainSubstring("tracker answer without issues"))),
		Entry("a body without issues is retried",
			body(`{"total_count": 0}`), 4, 4, []time.Duration{2 * time.Second, 4 * time.Second, 8 * time.Second},
			MatchError(ContainSubstring("tracker answer without issues"))),
		Entry("a total_count above the issues returned is a cut-short batch, not unknown tickets, and not retried",
			body(`{"issues": [{"id": 90001, "tracker": {"id": 1, "name": "Bug"}}], "total_count": 2, "offset": 0, "limit": 100}`), 1, 1, []time.Duration{},
			MatchError(ContainSubstring("1 of 2"))),
	)

	It("follows no redirect, through the HTTP client it builds or one given that would", func() {
		fake.script(1, 2, func(w http.ResponseWriter, _ time.Time) {
			w.Header().Set("Location", "/moved/issues.json")
			w.WriteHeader(http.StatusFound)
		})
		follows := server.Client()
		follows.CheckRedirect = func(*http.Request, []*http.Request) error { return nil }
		built, err := tracker.NewClient(server.URL, tracker.WithClock(clock))
		Expect(err).NotTo(HaveOccurred())
		u, err := url.Parse(server.URL)
		Expect(err).NotTo(HaveOccurred())

		for _, c := range []*tracker.Client{built, newClient(tracker.WithHTTPClient(follows))} {
			_, err = c.Tickets(context.Background(), []int{90001})
			Expect(err).To(MatchError(And(ContainSubstring("HTTP 302"), ContainSubstring(u.Host))))
		}

		Expect(fake.seen()).To(HaveExactElements(HaveField("Path", "/issues.json"), HaveField("Path", "/issues.json")))
	})

	It("stops waiting to retry when the context ends", func() {
		ctx, cancel := context.WithCancel(context.Background())
		DeferCleanup(cancel)
		clock.onSleep = cancel
		fake.failRequests(1, 4)

		_, err := newClient().Tickets(ctx, []int{90001})

		Expect(err).To(MatchError(context.Canceled))
		Expect(fake.seen()).To(HaveLen(1))
		Expect(clock.sleeps()).To(Equal([]time.Duration{2 * time.Second}))
	})

	It("gives up after the fourth failure", func() {
		fake.failRequests(1, 4)

		_, err := newClient().Tickets(context.Background(), []int{90001})

		Expect(err).To(MatchError(ContainSubstring("HTTP 503")))
		Expect(fake.seen()).To(HaveLen(4))
	})

	It("does not retry a request the tracker refuses", func() {
		fake.failStatus = http.StatusForbidden
		fake.failRequests(1, 1)

		_, err := newClient().Tickets(context.Background(), []int{90001})

		Expect(err).To(MatchError(ContainSubstring("HTTP 403")))
		Expect(fake.seen()).To(HaveLen(1))
	})
})

package ghapi_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/jhoblitt/rook-dev-stats/internal/ghapi"
)

type reply struct {
	status int
	header map[string]string
	body   string
	// hangUp closes the connection without answering.
	hangUp bool
}

type received struct {
	auth string
	body map[string]any
}

// scripted answers the n-th request with replies[n], repeating the last one.
type scripted struct {
	mu       sync.Mutex
	replies  []reply
	requests []received
}

func (s *scripted) script(replies ...reply) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.replies = replies
}

func (s *scripted) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	raw, err := io.ReadAll(r.Body)
	Expect(err).NotTo(HaveOccurred())
	var body map[string]any
	Expect(json.Unmarshal(raw, &body)).To(Succeed())

	s.mu.Lock()
	n := len(s.requests)
	s.requests = append(s.requests, received{auth: r.Header.Get("Authorization"), body: body})
	rep := s.replies[min(n, len(s.replies)-1)]
	s.mu.Unlock()

	if rep.hangUp {
		hj, ok := w.(http.Hijacker)
		Expect(ok).To(BeTrue(), "%T cannot hang up", w)
		conn, _, err := hj.Hijack()
		Expect(err).NotTo(HaveOccurred())
		Expect(conn.Close()).To(Succeed())
		return
	}
	for k, v := range rep.header {
		w.Header().Set(k, v)
	}
	w.WriteHeader(rep.status)
	fmt.Fprint(w, rep.body)
}

func (s *scripted) received() []received {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]received{}, s.requests...)
}

const (
	token = "s3cr3t-token"
	// resetEpoch is 2026-11-15T13:00:00Z.
	resetEpoch = "1794747600"
)

var probe = ghapi.Query{Name: "Probe", Text: "query Probe { viewer { login } }"}

var _ = Describe("Client", func() {
	var (
		handler  *scripted
		server   *httptest.Server
		client   *ghapi.Client
		attempts []int
	)

	BeforeEach(func() {
		handler = &scripted{}
		server = httptest.NewServer(handler)
		DeferCleanup(server.Close)
		attempts = nil
		var err error
		client, err = ghapi.NewClient(server.URL, token,
			ghapi.WithHTTPClient(server.Client()),
			ghapi.WithBackoff(func(_ context.Context, attempt int) error {
				attempts = append(attempts, attempt)
				return nil
			}))
		Expect(err).NotTo(HaveOccurred())
	})

	do := func() (map[string]any, error) {
		var out map[string]any
		err := client.Do(context.Background(), probe, map[string]any{"n": 3}, &out)
		return out, err
	}

	It("posts the query with the token and decodes data", func() {
		handler.script(reply{status: 200, body: `{"data":{"viewer":{"login":"octo"}}}`})

		out, err := do()

		Expect(err).NotTo(HaveOccurred())
		Expect(out).To(HaveKeyWithValue("viewer", HaveKeyWithValue("login", "octo")))
		got := handler.received()
		Expect(got).To(HaveLen(1))
		Expect(got[0].auth).To(Equal("bearer " + token))
		Expect(got[0].body).To(Equal(map[string]any{
			"query":         probe.Text,
			"operationName": "Probe",
			"variables":     map[string]any{"n": 3.0},
		}))
	})

	It("retries an empty body and a 5xx with backoff, then succeeds", func() {
		handler.script(
			reply{status: 200, body: ""},
			reply{status: 502, body: "<html>bad gateway</html>"},
			reply{status: 200, body: `{"data":{"viewer":{"login":"octo"}}}`},
		)

		out, err := do()

		Expect(err).NotTo(HaveOccurred())
		Expect(out).To(HaveKey("viewer"))
		Expect(handler.received()).To(HaveLen(3))
		Expect(attempts).To(Equal([]int{1, 2}))
	})

	It("gives up with ErrUnavailable after three failed attempts", func() {
		handler.script(reply{status: 503, body: "unavailable"})

		_, err := do()

		Expect(err).To(MatchError(ghapi.ErrUnavailable))
		Expect(err.Error()).To(ContainSubstring("503"))
		Expect(handler.received()).To(HaveLen(3))
		Expect(attempts).To(Equal([]int{1, 2}))
	})

	It("treats a body without data or errors as empty", func() {
		handler.script(reply{status: 200, body: `{"data":null}`})

		_, err := do()

		Expect(err).To(MatchError(ghapi.ErrUnavailable))
		Expect(handler.received()).To(HaveLen(3))
	})

	It("stops when the backoff fails", func() {
		handler.script(reply{status: 502})
		canceled := errors.New("canceled")
		var err error
		client, err = ghapi.NewClient(server.URL, token,
			ghapi.WithHTTPClient(server.Client()),
			ghapi.WithBackoff(func(context.Context, int) error { return canceled }))
		Expect(err).NotTo(HaveOccurred())

		_, err = do()

		Expect(err).To(MatchError(canceled))
		Expect(handler.received()).To(HaveLen(1))
	})

	DescribeTable("reports an exhausted rate limit with its reset time, without retrying",
		func(rep reply) {
			handler.script(rep)

			_, err := do()

			rl, ok := errors.AsType[*ghapi.RateLimitError](err)
			Expect(ok).To(BeTrue(), "error %v is not a RateLimitError", err)
			Expect(rl.Reset).To(BeTemporally("==", time.Date(2026, 11, 15, 13, 0, 0, 0, time.UTC)))
			Expect(err.Error()).To(ContainSubstring("2026-11-15T13:00:00Z"))
			Expect(handler.received()).To(HaveLen(1))
		},
		Entry("HTTP 403 with no remaining allowance", reply{
			status: 403,
			header: map[string]string{"x-ratelimit-remaining": "0", "x-ratelimit-reset": resetEpoch},
			body:   `{"message":"API rate limit exceeded"}`,
		}),
		Entry("HTTP 429 with no remaining allowance", reply{
			status: 429,
			header: map[string]string{"x-ratelimit-remaining": "0", "x-ratelimit-reset": resetEpoch},
		}),
		Entry("HTTP 200 with a RATE_LIMITED GraphQL error", reply{
			status: 200,
			header: map[string]string{"x-ratelimit-remaining": "0", "x-ratelimit-reset": resetEpoch},
			body:   `{"errors":[{"type":"RATE_LIMITED","message":"API rate limit exceeded for user ID 1."}]}`,
		}),
	)

	It("gives up with ErrUnavailable after the server hangs up on three attempts", func() {
		handler.script(reply{hangUp: true})

		_, err := do()

		Expect(err).To(MatchError(ghapi.ErrUnavailable))
		Expect(handler.received()).To(HaveLen(3))
		Expect(attempts).To(Equal([]int{1, 2}))
	})

	It("gives up with ErrUnavailable after three bodies that are not JSON", func() {
		handler.script(reply{status: 200, body: "<html>ok</html>"})

		_, err := do()

		Expect(err).To(MatchError(ghapi.ErrUnavailable))
		Expect(err).To(MatchError(ContainSubstring("malformed response")))
		Expect(handler.received()).To(HaveLen(3))
	})

	It("returns context.Canceled for a context canceled before the request, without a backoff", func() {
		handler.script(reply{status: 200, body: `{"data":{"viewer":{"login":"octo"}}}`})
		ctx, cancel := context.WithCancel(context.Background())
		cancel()

		var out map[string]any
		err := client.Do(ctx, probe, nil, &out)

		Expect(err).To(MatchError(context.Canceled))
		Expect(attempts).To(BeEmpty())
		Expect(handler.received()).To(BeEmpty())
	})

	It("reports an exhausted rate limit without a reset header as resetting at an unknown time", func() {
		handler.script(reply{status: 403, header: map[string]string{"x-ratelimit-remaining": "0"}})

		_, err := do()

		rl, ok := errors.AsType[*ghapi.RateLimitError](err)
		Expect(ok).To(BeTrue(), "error %v is not a RateLimitError", err)
		Expect(rl.Reset).To(BeZero())
		Expect(err.Error()).To(ContainSubstring("reset time unknown"))
		Expect(handler.received()).To(HaveLen(1))
	})

	It("fails on any other GraphQL error, naming its message, without retrying", func() {
		handler.script(reply{status: 200, body: `{"errors":[{"type":"FORBIDDEN","message":"Resource not accessible by integration"}]}`})

		_, err := do()

		Expect(err).To(MatchError(ContainSubstring("Resource not accessible by integration")))
		Expect(err).NotTo(MatchError(ghapi.ErrUnavailable))
		nf, _ := errors.AsType[*ghapi.NotFoundError](err)
		Expect(nf).NotTo(HaveOccurred(), "error %v is a NotFoundError", err)
		Expect(handler.received()).To(HaveLen(1))
	})

	It("returns a *NotFoundError with the path of each object GitHub could not resolve, and decodes the rest, without retrying", func() {
		handler.script(reply{status: 200, body: `{"data":{"repository":{"p0":{"number":1},"p1":null,"p2":null}},"errors":[` +
			`{"type":"NOT_FOUND","path":["repository","p1"],"message":"Could not resolve to a PullRequest with the number of 7."},` +
			`{"type":"NOT_FOUND","path":["repository","p2"],"message":"Could not resolve to a PullRequest with the number of 8."}]}`})

		out, err := do()

		nf, ok := errors.AsType[*ghapi.NotFoundError](err)
		Expect(ok).To(BeTrue(), "error %v is not a NotFoundError", err)
		Expect(nf.Paths).To(Equal([]string{"repository.p1", "repository.p2"}))
		Expect(err).To(MatchError(ContainSubstring("Could not resolve to a PullRequest with the number of 7.")))
		Expect(err).NotTo(MatchError(ghapi.ErrUnavailable))
		Expect(out).To(HaveKeyWithValue("repository", HaveKeyWithValue("p0", HaveKeyWithValue("number", 1.0))))
		Expect(handler.received()).To(HaveLen(1))
	})

	It("is no *NotFoundError when GitHub reports another error beside a NOT_FOUND", func() {
		handler.script(reply{status: 200, body: `{"data":{"repository":{"p0":null,"p1":null}},"errors":[` +
			`{"type":"NOT_FOUND","path":["repository","p0"],"message":"Could not resolve to a PullRequest with the number of 7."},` +
			`{"type":"SERVICE_UNAVAILABLE","path":["repository","p1"],"message":"Something went wrong while executing your query."}]}`})

		_, err := do()

		nf, _ := errors.AsType[*ghapi.NotFoundError](err)
		Expect(nf).NotTo(HaveOccurred(), "error %v is a NotFoundError", err)
		Expect(err).To(MatchError(ContainSubstring("Something went wrong while executing your query.")))
		Expect(handler.received()).To(HaveLen(1))
	})

	It("fails on a 4xx without retrying and keeps the token out of the error", func() {
		handler.script(reply{status: 401, body: `{"message":"Bad credentials"}`})

		_, err := do()

		Expect(err).To(MatchError(ContainSubstring("401")))
		Expect(err.Error()).NotTo(ContainSubstring(token))
		Expect(handler.received()).To(HaveLen(1))
	})
})

var _ = Describe("NewClient", func() {
	DescribeTable("refuses an endpoint that would expose the token, without echoing its user or password",
		func(endpoint, why string) {
			c, err := ghapi.NewClient(endpoint, token)

			Expect(err).To(MatchError(ContainSubstring(why)))
			Expect(c).To(BeNil())
			for _, secret := range []string{token, "octo", "pa55", "%zz"} {
				Expect(err.Error()).NotTo(ContainSubstring(secret))
			}
		},
		Entry("http to a host that is not loopback", "http://example.org/graphql", "https"),
		Entry("http to a name that only begins like localhost", "http://localhost.example.org/graphql", "https"),
		Entry("a user and password", "https://octo:pa55@api.github.com/graphql", "user or password"),
		Entry("a user alone, as a token would be", "https://octo@api.github.com/graphql", "user or password"),
		Entry("a user and password in a URL that does not parse", "https://octo:pa55%zz@api.github.com/graphql", "parsing"),
		Entry("a URL without a user that does not parse, with the parse error", "http://[::1", "parsing API URL: missing ']' in host"),
		Entry("a fragment", "https://api.github.com/graphql#frag", "fragment"),
		Entry("no host", "https:///graphql", "host"),
	)

	DescribeTable("accepts an endpoint the token may travel to",
		func(endpoint string) {
			c, err := ghapi.NewClient(endpoint, token)

			Expect(err).NotTo(HaveOccurred())
			Expect(c).NotTo(BeNil())
		},
		Entry("the default endpoint", ghapi.DefaultEndpoint),
		Entry("http to localhost", "http://localhost:8080/graphql"),
		Entry("http to an address in 127.0.0.0/8", "http://127.3.4.5:8080/graphql"),
		Entry("http to ::1", "http://[::1]:8080/graphql"),
	)
})

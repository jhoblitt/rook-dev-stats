package ghapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// DefaultEndpoint is GitHub's GraphQL API.
const DefaultEndpoint = "https://api.github.com/graphql"

// attempts is how many times Do sends a request before giving up on it.
const attempts = 3

// ErrUnavailable is returned when every attempt at a request failed in a way
// that a retry could fix: a network error, a 5xx, or an empty or malformed
// body. GitHub answers an oversized query this way, so a caller can shrink
// the request and try again.
var ErrUnavailable = errors.New("github returned no usable response")

// RateLimitError is returned when GitHub refuses a request because the
// allowance is spent. Reset is zero when GitHub did not say when it resets.
type RateLimitError struct {
	Reset time.Time
}

func (e *RateLimitError) Error() string {
	if e.Reset.IsZero() {
		return "github rate limit exhausted, reset time unknown"
	}
	return "github rate limit exhausted, resets at " + e.Reset.UTC().Format(time.RFC3339)
}

// NotFoundError is returned when every error GitHub reports for a request is
// a NOT_FOUND: an object the query names that GitHub cannot resolve, such as
// a pull request deleted since it was listed. Paths holds where each is in
// the reply, its path's elements joined by dots, such as
// repository.pullRequest; the reply's data holds null there, and Do still
// decodes the rest.
type NotFoundError struct {
	Paths    []string
	messages []string
}

func (e *NotFoundError) Error() string {
	return "graphql: " + strings.Join(e.messages, "; ")
}

// Query is one named GraphQL operation.
type Query struct {
	Name string
	Text string
}

// Client sends GraphQL queries to one endpoint.
type Client struct {
	endpoint string
	token    string
	http     *http.Client
	backoff  func(ctx context.Context, attempt int) error
	logger   *slog.Logger
}

// Option configures a Client.
type Option func(*Client)

// WithHTTPClient replaces the default HTTP client.
func WithHTTPClient(h *http.Client) Option {
	return func(c *Client) { c.http = h }
}

// WithBackoff replaces the wait between attempts. It is called with the
// number of the attempt that just failed, starting at 1, and a non-nil
// return ends the request with that error.
func WithBackoff(f func(ctx context.Context, attempt int) error) Option {
	return func(c *Client) { c.backoff = f }
}

// WithLogger replaces the logger, slog.Default() otherwise.
func WithLogger(l *slog.Logger) Option {
	return func(c *Client) { c.logger = l }
}

// NewClient returns a client that authenticates to endpoint with token. The
// endpoint must be https, or http to a loopback host, so that the token never
// crosses a network in clear text, and must carry no user, password or
// fragment.
func NewClient(endpoint, token string, opts ...Option) (*Client, error) {
	if err := checkEndpoint(endpoint); err != nil {
		return nil, err
	}
	c := &Client{
		endpoint: endpoint,
		token:    token,
		http:     &http.Client{Timeout: time.Minute},
		backoff:  sleepBackoff,
		logger:   slog.Default(),
	}
	for _, o := range opts {
		o(c)
	}
	return c, nil
}

func checkEndpoint(endpoint string) error {
	u, err := url.Parse(endpoint)
	if err != nil {
		// The url.Error repeats the URL, and its cause can quote part of a
		// password, so neither is shown for a URL that may carry one.
		if strings.Contains(endpoint, "@") {
			return errors.New("parsing API URL: not a valid URL")
		}
		return fmt.Errorf("parsing API URL: %w", errors.Unwrap(err))
	}
	switch {
	case u.User != nil:
		return errors.New("API URL must not carry a user or password")
	case u.Host == "":
		return fmt.Errorf("API URL %s: no host", u)
	case u.Fragment != "":
		return fmt.Errorf("API URL %s: must not carry a fragment", u)
	case u.Scheme != "https" && (u.Scheme != "http" || !loopback(u.Hostname())):
		return fmt.Errorf("API URL %s: scheme must be https, or http to a loopback host, so that the token is not sent in clear text", u)
	}
	return nil
}

func loopback(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	a, err := netip.ParseAddr(host)
	return err == nil && a.IsLoopback()
}

func sleepBackoff(ctx context.Context, attempt int) error {
	t := time.NewTimer(2 * time.Second << (attempt - 1))
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// transient marks a failure that a retry of the same request could fix.
type transient struct{ err error }

func (t transient) Error() string { return t.err.Error() }
func (t transient) Unwrap() error { return t.err }

// Do sends q with vars and decodes the response's data into out. A
// transient failure is retried with backoff; after the last attempt the
// error wraps ErrUnavailable. A spent rate limit is a *RateLimitError and is
// not retried, nor is a *NotFoundError, whose reply's data is decoded into
// out all the same.
func (c *Client) Do(ctx context.Context, q Query, vars map[string]any, out any) error {
	body, err := json.Marshal(struct {
		Query         string         `json:"query"`
		OperationName string         `json:"operationName"`
		Variables     map[string]any `json:"variables"`
	}{q.Text, q.Name, vars})
	if err != nil {
		return fmt.Errorf("encoding %s: %w", q.Name, err)
	}
	for attempt := 1; ; attempt++ {
		data, err := c.post(ctx, body)
		nf, _ := errors.AsType[*NotFoundError](err)
		if err == nil || nf != nil && len(data) > 0 {
			if derr := json.Unmarshal(data, out); derr != nil {
				return fmt.Errorf("decoding %s: %w", q.Name, derr)
			}
			c.logRateLimit(ctx, q.Name, data)
		}
		if err == nil {
			return nil
		}
		t, ok := errors.AsType[transient](err)
		if !ok {
			return fmt.Errorf("%s: %w", q.Name, err)
		}
		if attempt == attempts {
			return fmt.Errorf("%s: %w after %d attempts: %w", q.Name, ErrUnavailable, attempts, t)
		}
		c.logger.WarnContext(ctx, "retrying graphql request",
			slog.String("operation", q.Name),
			slog.Int("attempt", attempt),
			slog.String("error", t.Error()))
		if berr := c.backoff(ctx, attempt); berr != nil {
			return fmt.Errorf("%s: %w", q.Name, berr)
		}
	}
}

// post sends one request and returns the response's data member.
func (c *Client) post(ctx context.Context, body []byte) (json.RawMessage, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("building request: %w", err)
	}
	req.Header.Set("Authorization", "bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "cephstats")

	resp, err := c.http.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, transient{err}
	}
	raw, readErr := io.ReadAll(resp.Body)
	readErr = errors.Join(readErr, resp.Body.Close())

	switch {
	case (resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusTooManyRequests) &&
		resp.Header.Get("x-ratelimit-remaining") == "0":
		return nil, &RateLimitError{Reset: resetTime(resp.Header)}
	case resp.StatusCode >= http.StatusInternalServerError:
		return nil, transient{fmt.Errorf("HTTP %d", resp.StatusCode)}
	case resp.StatusCode != http.StatusOK:
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, excerpt(raw))
	case readErr != nil:
		return nil, transient{fmt.Errorf("reading response: %w", readErr)}
	case len(bytes.TrimSpace(raw)) == 0:
		return nil, transient{errors.New("empty response")}
	}

	var env struct {
		Data   json.RawMessage `json:"data"`
		Errors []struct {
			Type    string `json:"type"`
			Message string `json:"message"`
			Path    []any  `json:"path"`
		} `json:"errors"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		return nil, transient{fmt.Errorf("malformed response: %w", err)}
	}
	if len(env.Errors) > 0 {
		nf := &NotFoundError{}
		for _, e := range env.Errors {
			if e.Type == "RATE_LIMITED" {
				return nil, &RateLimitError{Reset: resetTime(resp.Header)}
			}
			nf.messages = append(nf.messages, e.Message)
			if e.Type == "NOT_FOUND" {
				nf.Paths = append(nf.Paths, joinPath(e.Path))
			}
		}
		if len(nf.Paths) == len(env.Errors) {
			return env.Data, nf
		}
		return nil, fmt.Errorf("graphql: %s", strings.Join(nf.messages, "; "))
	}
	if len(env.Data) == 0 || string(env.Data) == "null" {
		return nil, transient{errors.New("response without data")}
	}
	return env.Data, nil
}

// joinPath joins a GraphQL error's path, whose elements are field names and
// list indexes, with dots.
func joinPath(path []any) string {
	parts := make([]string, len(path))
	for i, p := range path {
		parts[i] = fmt.Sprint(p)
	}
	return strings.Join(parts, ".")
}

func (c *Client) logRateLimit(ctx context.Context, op string, data json.RawMessage) {
	var rl struct {
		RateLimit *struct {
			Cost      int       `json:"cost"`
			Remaining int       `json:"remaining"`
			ResetAt   time.Time `json:"resetAt"`
		} `json:"rateLimit"`
	}
	if json.Unmarshal(data, &rl) != nil || rl.RateLimit == nil {
		return
	}
	c.logger.DebugContext(ctx, "graphql request",
		slog.String("operation", op),
		slog.Int("cost", rl.RateLimit.Cost),
		slog.Int("remaining", rl.RateLimit.Remaining),
		slog.Time("reset_at", rl.RateLimit.ResetAt))
}

func resetTime(h http.Header) time.Time {
	secs, err := strconv.ParseInt(h.Get("x-ratelimit-reset"), 10, 64)
	if err != nil {
		return time.Time{}
	}
	return time.Unix(secs, 0).UTC()
}

func excerpt(b []byte) string {
	const limit = 200
	s := strings.TrimSpace(string(b))
	if len(s) > limit {
		return s[:limit] + "…"
	}
	return s
}

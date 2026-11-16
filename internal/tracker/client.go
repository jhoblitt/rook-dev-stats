package tracker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jhoblitt/ceph-dev-stats/internal/version"
)

// MinInterval is the least time between the starts of two requests,
// whatever interval a Client is given.
const MinInterval = time.Second

// attempts is a request's first try and its three retries.
const attempts = 4

// maxRetryAfter is the longest Retry-After a run waits out; a tracker that
// asks for longer is left alone until the operator runs again.
const maxRetryAfter = 5 * time.Minute

// maxBody bounds what is read of one answer; a page of 100 issues with
// their relations is a few hundred kilobytes.
const maxBody = 16 << 20

// Clock is the time a Client paces and backs off by.
type Clock interface {
	Now() time.Time
	// Sleep waits for d, or returns ctx's error when ctx ends first.
	Sleep(ctx context.Context, d time.Duration) error
}

type realClock struct{}

func (realClock) Now() time.Time { return time.Now() }

func (realClock) Sleep(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// Client asks tracker.ceph.com for tickets: anonymously, one request at a
// time, the starts of two requests at least its interval apart.
type Client struct {
	endpoint string
	agent    string
	http     *http.Client
	clock    Clock
	interval time.Duration
	logger   *slog.Logger

	// mu makes requests sequential even for concurrent callers.
	mu sync.Mutex
	// last is when the previous request was sent, zero before the first.
	last time.Time
}

// Option configures a Client.
type Option func(*Client)

// WithHTTPClient replaces the default HTTP client. Its cookie jar and its
// redirect policy, if it has them, are not used.
func WithHTTPClient(h *http.Client) Option {
	return func(c *Client) { c.http = h }
}

// WithClock replaces the wall clock.
func WithClock(clk Clock) Option {
	return func(c *Client) { c.clock = clk }
}

// WithInterval sets the least time between the starts of two requests. An
// interval shorter than MinInterval is raised to it.
func WithInterval(d time.Duration) Option {
	return func(c *Client) { c.interval = d }
}

// WithLogger replaces the logger, slog.Default() otherwise.
func WithLogger(l *slog.Logger) Option {
	return func(c *Client) { c.logger = l }
}

// NewClient returns a client for the Redmine at baseURL. The URL must be
// plain http or https with a host, and carry no user, password or query,
// so that nothing identifying is ever sent.
func NewClient(baseURL string, opts ...Option) (*Client, error) {
	u, err := url.Parse(baseURL)
	if err != nil {
		// The url.Error would repeat the URL, which may hold a password.
		return nil, fmt.Errorf("parsing tracker URL: %w", errors.Unwrap(err))
	}
	switch {
	case u.Scheme != "http" && u.Scheme != "https":
		return nil, fmt.Errorf("tracker URL %s: scheme must be http or https", u.Redacted())
	case u.Host == "":
		return nil, fmt.Errorf("tracker URL %s: no host", u.Redacted())
	case u.User != nil:
		return nil, errors.New("tracker URL must not carry a user or password")
	case u.RawQuery != "" || u.ForceQuery || u.Fragment != "":
		return nil, fmt.Errorf("tracker URL %s: must not carry a query or fragment", u.Redacted())
	}
	c := &Client{
		endpoint: strings.TrimSuffix(u.String(), "/") + "/issues.json",
		agent:    userAgent(),
		http:     &http.Client{Timeout: time.Minute},
		clock:    realClock{},
		interval: MinInterval,
		logger:   slog.Default(),
	}
	for _, o := range opts {
		o(c)
	}
	c.interval = max(c.interval, MinInterval)
	h := *c.http
	h.Jar = nil
	// A redirect followed inside one call would skip the pacing, so the
	// client never follows one: get turns it into an error.
	h.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	c.http = &h
	return c, nil
}

// userAgent names the tool and its version, and nothing about its user.
func userAgent() string {
	v := strings.Trim(version.Read().Version, "()")
	if v == "" {
		v = "devel"
	}
	return "cephstats/" + v
}

// Tickets asks for at most BatchSize tickets in one request, with every
// status and with relations. Every ticket asked for is in the answer: one
// the tracker did not return, private or deleted, has an empty type; an
// answer the tracker says it cut short is an error instead. A request that
// failed in a way a retry could fix is retried three times, after 2, 4 and
// 8 seconds or the longer wait a Retry-After asks for; a Retry-After of
// more than five minutes is an error. A redirect is an error, never
// followed.
func (c *Client) Tickets(ctx context.Context, ids []int) (map[int]Ticket, error) {
	ids = slices.Compact(slices.Sorted(slices.Values(ids)))
	if len(ids) == 0 {
		return map[int]Ticket{}, nil
	}
	if len(ids) > BatchSize {
		return nil, fmt.Errorf("asking for %d tickets in one request, at most %d", len(ids), BatchSize)
	}
	parts := make([]string, len(ids))
	for i, id := range ids {
		parts[i] = strconv.Itoa(id)
	}
	// Built by hand to keep the commas and the * readable; nothing in it
	// needs escaping.
	target := c.endpoint + "?issue_id=" + strings.Join(parts, ",") +
		"&status_id=*&include=relations&limit=" + strconv.Itoa(BatchSize)

	c.mu.Lock()
	defer c.mu.Unlock()
	for attempt := 1; ; attempt++ {
		issues, err := c.get(ctx, target)
		if err == nil {
			return tickets(ids, issues), nil
		}
		t, ok := errors.AsType[transient](err)
		if !ok {
			return nil, err
		}
		if attempt == attempts {
			return nil, fmt.Errorf("no usable answer after %d attempts: %w", attempts, t)
		}
		if t.retryAfter > maxRetryAfter {
			return nil, fmt.Errorf("tracker asked to wait %s before the next request, more than %s: %w", t.retryAfter, maxRetryAfter, t)
		}
		wait := max(2*time.Second<<(attempt-1), t.retryAfter)
		c.logger.WarnContext(ctx, "retrying tracker request",
			slog.Int("attempt", attempt),
			slog.Int("tickets", len(ids)),
			slog.Duration("wait", wait),
			slog.String("error", t.Error()))
		if err := c.clock.Sleep(ctx, wait); err != nil {
			return nil, err
		}
	}
}

// transient marks a failure that a retry of the same request could fix.
type transient struct {
	err error
	// retryAfter is the wait the tracker asked for, zero when it did not.
	retryAfter time.Duration
}

func (t transient) Error() string { return t.err.Error() }
func (t transient) Unwrap() error { return t.err }

type issue struct {
	ID      int `json:"id"`
	Tracker struct {
		Name string `json:"name"`
	} `json:"tracker"`
	Relations []struct {
		IssueID   int    `json:"issue_id"`
		IssueToID int    `json:"issue_to_id"`
		Type      string `json:"relation_type"`
	} `json:"relations"`
}

// pace waits until the interval since the previous request has passed.
func (c *Client) pace(ctx context.Context) error {
	if !c.last.IsZero() {
		if wait := c.last.Add(c.interval).Sub(c.clock.Now()); wait > 0 {
			if err := c.clock.Sleep(ctx, wait); err != nil {
				return err
			}
		}
	}
	c.last = c.clock.Now()
	return nil
}

func (c *Client) get(ctx context.Context, target string) ([]issue, error) {
	if err := c.pace(ctx); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, http.NoBody)
	if err != nil {
		return nil, fmt.Errorf("building tracker request: %w", err)
	}
	req.Header.Set("User-Agent", c.agent)
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, transient{err: err}
	}
	raw, readErr := io.ReadAll(io.LimitReader(resp.Body, maxBody))
	readErr = errors.Join(readErr, resp.Body.Close())

	switch {
	case resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= http.StatusInternalServerError:
		return nil, transient{
			err:        fmt.Errorf("tracker answered HTTP %d", resp.StatusCode),
			retryAfter: c.retryAfter(resp.Header.Get("Retry-After")),
		}
	case resp.StatusCode >= http.StatusMultipleChoices && resp.StatusCode < http.StatusBadRequest:
		return nil, redirected(resp)
	case resp.StatusCode != http.StatusOK:
		return nil, fmt.Errorf("tracker answered HTTP %d: %s", resp.StatusCode, excerpt(raw))
	case readErr != nil:
		return nil, transient{err: fmt.Errorf("reading tracker answer: %w", readErr)}
	case len(bytes.TrimSpace(raw)) == 0:
		return nil, transient{err: errors.New("empty tracker answer")}
	}
	var page struct {
		Issues     *[]issue `json:"issues"`
		TotalCount *int     `json:"total_count"`
	}
	if err := json.Unmarshal(raw, &page); err != nil {
		return nil, transient{err: fmt.Errorf("malformed tracker answer: %w", err)}
	}
	if page.Issues == nil {
		return nil, transient{err: errors.New("tracker answer without issues")}
	}
	// Not retried: a page cut short by the tracker's own limit would be cut
	// short again, and the tickets left out must not be saved as unknown.
	if page.TotalCount != nil && *page.TotalCount > len(*page.Issues) {
		return nil, fmt.Errorf("tracker returned %d of %d matching tickets, a batch cut short", len(*page.Issues), *page.TotalCount)
	}
	return *page.Issues, nil
}

// retryAfter is the wait a Retry-After header value asks for, in seconds
// or until an HTTP date, and zero when there is none or it is unreadable.
func (c *Client) retryAfter(v string) time.Duration {
	v = strings.TrimSpace(v)
	if v == "" {
		return 0
	}
	s, err := strconv.Atoi(v)
	if errors.Is(err, strconv.ErrRange) && !strings.HasPrefix(v, "-") {
		// Too many digits to parse is still a wait, and far over the cap.
		s, err = math.MaxInt32, nil
	}
	if err == nil {
		// Bounded so that a huge value cannot overflow a Duration.
		return time.Duration(min(max(s, 0), math.MaxInt32)) * time.Second
	}
	if t, err := http.ParseTime(v); err == nil {
		return max(t.Sub(c.clock.Now()), 0)
	}
	return 0
}

// redirected is the error for a redirect: the tracker has moved, and its
// URL is the operator's to change.
func redirected(resp *http.Response) error {
	loc, err := resp.Location()
	if err != nil {
		return fmt.Errorf("tracker answered HTTP %d without a usable Location, so the tracker URL may need changing", resp.StatusCode)
	}
	return fmt.Errorf("tracker answered HTTP %d, a redirect to host %s, so the tracker URL may need changing", resp.StatusCode, loc.Host)
}

// tickets is the answer to a request for ids, with an empty type for each
// ticket the tracker left out. A ticket not asked for is ignored.
func tickets(ids []int, issues []issue) map[int]Ticket {
	out := make(map[int]Ticket, len(ids))
	for _, id := range ids {
		out[id] = Ticket{}
	}
	for _, is := range issues {
		if _, asked := out[is.ID]; !asked {
			continue
		}
		t := Ticket{Type: is.Tracker.Name}
		if t.Type == TypeBackport {
			t.Parent = parent(is)
		}
		out[is.ID] = t
	}
	return out
}

// parent is the ticket a backport was copied from: Redmine lists the copy
// as the issue_to_id of a copied_to relation whose issue_id is the
// original. The original lists the same relation, which is not a parent
// of its own.
func parent(is issue) int {
	for _, r := range is.Relations {
		if r.Type == "copied_to" && r.IssueToID == is.ID {
			return r.IssueID
		}
	}
	return 0
}

func excerpt(b []byte) string {
	const limit = 200
	s := strings.TrimSpace(string(b))
	if len(s) > limit {
		return s[:limit] + "…"
	}
	return s
}

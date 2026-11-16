package tracker_test

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

// quiet is a logger for specs that do not read the log, which would
// otherwise go to the test binary's stderr.
func quiet() *slog.Logger {
	return slog.New(slog.DiscardHandler)
}

// fakeClock moves only when the code under test sleeps, or when the fake
// tracker spends time answering.
type fakeClock struct {
	mu    sync.Mutex
	now   time.Time
	slept []time.Duration
	// onSleep, when set, runs at the start of each sleep.
	onSleep func()
}

func newFakeClock() *fakeClock {
	return &fakeClock{now: time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC)}
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) Sleep(ctx context.Context, d time.Duration) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.onSleep != nil {
		c.onSleep()
	}
	c.slept = append(c.slept, d)
	c.now = c.now.Add(d)
	return ctx.Err()
}

func (c *fakeClock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

func (c *fakeClock) sleeps() []time.Duration {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]time.Duration{}, c.slept...)
}

// relation is one of an issue's relations, as Redmine lists it.
type relation struct {
	ID        int    `json:"id"`
	IssueID   int    `json:"issue_id"`
	IssueToID int    `json:"issue_to_id"`
	Type      string `json:"relation_type"`
}

type issue struct {
	typ       string
	relations []relation
}

// request is what the fake tracker saw of one request.
type request struct {
	Method string
	Path   string
	Query  string
	Header http.Header
	IDs    []int
	At     time.Time
}

// reply writes an answer of a spec's own in place of the fake's, at the
// fake clock's time now.
type reply func(w http.ResponseWriter, now time.Time)

// fakeTracker answers Redmine's filtered issue list from issues. Requests
// numbered failFrom to failFrom+failures-1, counting from 1, get
// failStatus instead, and a request with a scripted reply gets that.
type fakeTracker struct {
	mu         sync.Mutex
	clock      *fakeClock
	latency    time.Duration
	issues     map[int]issue
	failFrom   int
	failures   int
	failStatus int
	scripted   map[int]reply
	requests   []request
}

func newFakeTracker(clock *fakeClock) *fakeTracker {
	return &fakeTracker{clock: clock, issues: map[int]issue{}, failStatus: http.StatusServiceUnavailable, scripted: map[int]reply{}}
}

func (f *fakeTracker) failRequests(from, n int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.failFrom, f.failures = from, n
}

// script answers requests from to from+n-1, counting from 1, with rep.
func (f *fakeTracker) script(from, n int, rep reply) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for i := range n {
		f.scripted[from+i] = rep
	}
}

func (f *fakeTracker) add(id int, typ string, relations ...relation) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.issues[id] = issue{typ: typ, relations: relations}
}

func (f *fakeTracker) seen() []request {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.requests)
}

func (f *fakeTracker) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	defer GinkgoRecover()
	var ids []int
	if s := r.URL.Query().Get("issue_id"); s != "" {
		for p := range strings.SplitSeq(s, ",") {
			n, err := strconv.Atoi(p)
			Expect(err).NotTo(HaveOccurred(), "issue_id %q", s)
			ids = append(ids, n)
		}
	}
	f.mu.Lock()
	f.requests = append(f.requests, request{
		Method: r.Method, Path: r.URL.Path, Query: r.URL.RawQuery,
		Header: r.Header.Clone(), IDs: ids, At: f.clock.Now(),
	})
	n := len(f.requests)
	failing := n >= f.failFrom && n < f.failFrom+f.failures
	scripted := f.scripted[n]
	type issueJSON struct {
		ID      int `json:"id"`
		Project struct {
			ID   int    `json:"id"`
			Name string `json:"name"`
		} `json:"project"`
		Tracker struct {
			ID   int    `json:"id"`
			Name string `json:"name"`
		} `json:"tracker"`
		Subject   string     `json:"subject"`
		Relations []relation `json:"relations,omitempty"`
	}
	out := []issueJSON{}
	for _, id := range ids {
		is, ok := f.issues[id]
		if !ok {
			continue
		}
		j := issueJSON{ID: id, Subject: "a synthetic issue", Relations: is.relations}
		j.Project.ID, j.Project.Name = 1, "Ceph"
		j.Tracker.ID, j.Tracker.Name = 1, is.typ
		out = append(out, j)
	}
	f.mu.Unlock()
	f.clock.advance(f.latency)

	if scripted != nil {
		scripted(w, f.clock.Now())
		return
	}
	if failing {
		w.WriteHeader(f.failStatus)
		return
	}
	// Redmine lists the newest issue first.
	slices.SortFunc(out, func(a, b issueJSON) int { return b.ID - a.ID })
	w.Header().Set("Content-Type", "application/json")
	Expect(json.NewEncoder(w).Encode(map[string]any{
		"issues": out, "total_count": len(out), "offset": 0, "limit": 100,
	})).To(Succeed())
}

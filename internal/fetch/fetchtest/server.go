// Package fetchtest is an in-memory stand-in for GitHub's GraphQL API that
// answers the queries cephstats fetch sends, for specs.
package fetchtest

import (
	"cmp"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jhoblitt/ceph-dev-stats/internal/fetch"
	"github.com/jhoblitt/ceph-dev-stats/internal/ghapi"
)

// Request is one request the server received.
type Request struct {
	Operation     string
	Variables     map[string]any
	Authorization string
}

// Int returns the integer variable key, or -1 when it is absent.
func (r Request) Int(key string) int {
	f, ok := r.Variables[key].(float64)
	if !ok {
		return -1
	}
	return int(f)
}

// String returns the string variable key, or "" when it is absent.
func (r Request) String(key string) string {
	s, ok := r.Variables[key].(string)
	if !ok {
		return ""
	}
	return s
}

// Reply overrides the server's answer to one request.
type Reply struct {
	Status int
	Header map[string]string
	Body   string
}

// Server answers PullRequests, the connection pages, Counts, SearchCount,
// AuthorBaselines, CommitNames, CommitNamesPage and PullRequestNumbers from
// the pull requests it holds. Cursors are offsets; lists are ordered by
// updatedAt then number, both descending. A held pull request's CommitNames are its commits' names
// as GitHub keeps them, which only the names queries return.
type Server struct {
	*httptest.Server

	mu          sync.Mutex
	prs         map[int]*fetch.Entry
	requests    []Request
	intercept   func(n int, r Request) *Reply
	after       func(n int, r Request)
	searchCount int
	priorPRs    map[string]int
	createdAt   time.Time
}

// NewServer starts a server holding prs, in a repository created at
// fetch.WindowStart. Close it when done.
func NewServer(prs ...fetch.Entry) *Server {
	s := &Server{prs: map[int]*fetch.Entry{}, priorPRs: map[string]int{}, createdAt: fetch.WindowStart}
	for i := range prs {
		pr := prs[i]
		s.prs[pr.Number] = &pr
	}
	s.Server = httptest.NewServer(http.HandlerFunc(s.serve))
	return s
}

// Intercept makes f answer request n (counted from 0) in place of the
// server whenever f returns non-nil.
func (s *Server) Intercept(f func(n int, r Request) *Reply) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.intercept = f
}

// After makes f run once the answer to request n is built, to change the
// server's state mid-walk.
func (s *Server) After(f func(n int, r Request)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.after = f
}

// SetCounts sets the issueCount SearchCount answers, which need not be the
// number of pull requests the server holds, and the AuthorBaselines answers
// by login.
func (s *Server) SetCounts(searchCount int, priorPRs map[string]int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.searchCount = searchCount
	s.priorPRs = priorPRs
}

// SetCreatedAt sets the repository's createdAt that Counts answers.
func (s *Server) SetCreatedAt(t time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.createdAt = t
}

// Delete drops the held pull request number, so that the server answers a
// later question about it as GitHub does about one it cannot resolve.
func (s *Server) Delete(number int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.prs, number)
}

// Update applies f to the held pull request number.
func (s *Server) Update(number int, f func(*fetch.Entry)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	f(s.prs[number])
}

// Requests returns every request received so far.
func (s *Server) Requests() []Request {
	s.mu.Lock()
	defer s.mu.Unlock()
	return slices.Clone(s.requests)
}

// Operations returns the requests for operation op.
func (s *Server) Operations(op string) []Request {
	var out []Request
	for _, r := range s.Requests() {
		if r.Operation == op {
			out = append(out, r)
		}
	}
	return out
}

func (s *Server) serve(w http.ResponseWriter, r *http.Request) {
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	var body struct {
		OperationName string         `json:"operationName"`
		Variables     map[string]any `json:"variables"`
	}
	if err = json.Unmarshal(raw, &body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	req := Request{Operation: body.OperationName, Variables: body.Variables, Authorization: r.Header.Get("Authorization")}

	s.mu.Lock()
	n := len(s.requests)
	s.requests = append(s.requests, req)
	intercept, after := s.intercept, s.after
	s.mu.Unlock()

	if intercept != nil {
		if rep := intercept(n, req); rep != nil {
			for k, v := range rep.Header {
				w.Header().Set(k, v)
			}
			w.WriteHeader(rep.Status)
			fmt.Fprint(w, rep.Body)
			return
		}
	}

	s.mu.Lock()
	data, errs, err := s.answer(req)
	s.mu.Unlock()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	out := map[string]any{"data": data}
	if len(errs) > 0 {
		out["errors"] = errs
	}
	reply, err := json.Marshal(out)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	// Before the reply is sent, so the client cannot race ahead of it.
	if after != nil {
		after(n, req)
	}
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprint(w, string(reply))
}

var authorLogin = regexp.MustCompile(`author:(\S+)`)

// notFound is GitHub's error for a pull request number it cannot resolve,
// at path in the reply, whose data holds null there.
func notFound(number int, path ...string) map[string]any {
	return map[string]any{
		"type":    "NOT_FOUND",
		"path":    path,
		"message": fmt.Sprintf("Could not resolve to a PullRequest with the number of %d.", number),
	}
}

// answer returns the reply's data and its GraphQL errors, or an error for a
// request the server cannot answer at all.
func (s *Server) answer(r Request) (data map[string]any, errs []map[string]any, err error) {
	data, err = s.data(r)
	if err != nil {
		return nil, nil, err
	}
	switch r.Operation {
	case ghapi.PullRequests.Name, ghapi.Counts.Name, ghapi.SearchCount.Name, ghapi.AuthorBaselines(0).Name:
		return data, nil, nil
	case ghapi.CommitNames(0).Name, ghapi.PullRequestNumbers(0).Name:
		for i := 0; ; i++ {
			n := r.Int("n" + strconv.Itoa(i))
			if n < 0 {
				return data, errs, nil
			}
			if _, ok := s.prs[n]; !ok {
				errs = append(errs, notFound(n, "repository", "p"+strconv.Itoa(i)))
			}
		}
	}
	if _, ok := s.prs[r.Int("number")]; !ok {
		return data, []map[string]any{notFound(r.Int("number"), "repository", "pullRequest")}, nil
	}
	return data, nil, nil
}

// data returns the reply's data, in which a pull request the server does not
// hold is null.
func (s *Server) data(r Request) (map[string]any, error) {
	switch r.Operation {
	case ghapi.PullRequests.Name:
		return s.list(r)
	case ghapi.Counts.Name:
		open := 0
		for _, pr := range s.prs {
			if pr.State == "OPEN" {
				open++
			}
		}
		return map[string]any{
			"repository": map[string]any{
				"createdAt": s.createdAt,
				"total":     map[string]any{"totalCount": len(s.prs)},
				"open":      map[string]any{"totalCount": open},
			},
		}, nil
	case ghapi.SearchCount.Name:
		return map[string]any{"search": map[string]any{"issueCount": s.searchCount}}, nil
	case ghapi.AuthorBaselines(0).Name:
		out := map[string]any{}
		for i := 0; ; i++ {
			q := r.String("q" + strconv.Itoa(i))
			if q == "" {
				return out, nil
			}
			m := authorLogin.FindStringSubmatch(q)
			if m == nil {
				return nil, fmt.Errorf("no author in %q", q)
			}
			out["a"+strconv.Itoa(i)] = map[string]any{"issueCount": s.priorPRs[m[1]]}
		}
	case ghapi.CommitNames(0).Name:
		repo := map[string]any{}
		for i := 0; ; i++ {
			n := r.Int("n" + strconv.Itoa(i))
			if n < 0 {
				return map[string]any{"repository": repo}, nil
			}
			pr, ok := s.prs[n]
			if !ok {
				repo["p"+strconv.Itoa(i)] = nil
				continue
			}
			repo["p"+strconv.Itoa(i)] = map[string]any{"commits": page(nameNodes(pr), 0, r.Int("first"))}
		}
	case ghapi.PullRequestNumbers(0).Name:
		repo := map[string]any{}
		for i := 0; ; i++ {
			n := r.Int("n" + strconv.Itoa(i))
			if n < 0 {
				return map[string]any{"repository": repo}, nil
			}
			if _, ok := s.prs[n]; !ok {
				repo["p"+strconv.Itoa(i)] = nil
				continue
			}
			repo["p"+strconv.Itoa(i)] = map[string]any{"number": n}
		}
	case ghapi.CommitNamesPage.Name:
		pr, ok := s.prs[r.Int("number")]
		if !ok {
			return map[string]any{"repository": map[string]any{"pullRequest": nil}}, nil
		}
		start, err := offset(r.String("after"))
		if err != nil {
			return nil, err
		}
		return map[string]any{"repository": map[string]any{"pullRequest": map[string]any{
			"commits": page(nameNodes(pr), start, r.Int("first")),
		}}}, nil
	}
	i := slices.IndexFunc(ghapi.Connections, func(c ghapi.Connection) bool {
		return r.Operation == ghapi.ConnectionPage(c).Name
	})
	if i < 0 {
		return nil, fmt.Errorf("unknown operation %q", r.Operation)
	}
	c := ghapi.Connections[i]
	pr, ok := s.prs[r.Int("number")]
	if !ok {
		return map[string]any{"repository": map[string]any{"pullRequest": nil}}, nil
	}
	start, err := offset(r.String("after"))
	if err != nil {
		return nil, err
	}
	return map[string]any{"repository": map[string]any{"pullRequest": map[string]any{
		string(c): page(connectionNodes(pr, c), start, r.Int("first")),
	}}}, nil
}

func (s *Server) list(r Request) (map[string]any, error) {
	var states []string
	if v, ok := r.Variables["states"].([]any); ok {
		for _, st := range v {
			states = append(states, fmt.Sprint(st))
		}
	}
	var prs []*fetch.Entry
	for _, pr := range s.prs {
		if states == nil || slices.Contains(states, pr.State) {
			prs = append(prs, pr)
		}
	}
	slices.SortFunc(prs, func(a, b *fetch.Entry) int {
		return cmp.Or(b.UpdatedAt.Compare(a.UpdatedAt), cmp.Compare(b.Number, a.Number))
	})
	nested := r.Int("nested")
	nodes := make([]any, len(prs))
	for i, pr := range prs {
		nodes[i] = node(pr, nested)
	}
	start, err := offset(r.String("after"))
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"repository": map[string]any{"pullRequests": page(nodes, start, r.Int("first"))},
	}, nil
}

func node(pr *fetch.Entry, nested int) map[string]any {
	n := map[string]any{
		"number": pr.Number, "title": pr.Title, "body": pr.Body, "state": pr.State,
		"isDraft": pr.IsDraft, "createdAt": pr.CreatedAt, "updatedAt": pr.UpdatedAt,
		"closedAt": pr.ClosedAt, "mergedAt": pr.MergedAt, "baseRefName": pr.BaseRefName,
		"additions": pr.Additions, "deletions": pr.Deletions, "changedFiles": pr.ChangedFiles,
		"authorAssociation": pr.AuthorAssociation, "author": pr.Author,
	}
	for _, c := range ghapi.Connections {
		n[string(c)] = page(connectionNodes(pr, c), 0, nested)
	}
	return n
}

func connectionNodes(pr *fetch.Entry, c ghapi.Connection) []any {
	var out []any
	switch c {
	case ghapi.Labels:
		for _, l := range pr.Labels {
			out = append(out, l)
		}
	case ghapi.Commits:
		for _, cm := range pr.Commits {
			out = append(out, map[string]any{"commit": cm})
		}
	case ghapi.Comments:
		for _, cm := range pr.Comments {
			out = append(out, cm)
		}
	case ghapi.Reviews:
		for _, rv := range pr.Reviews {
			out = append(out, rv)
		}
	case ghapi.TimelineItems:
		for _, ev := range pr.TimelineItems {
			out = append(out, ev)
		}
	}
	return out
}

// nameNodes are pr's commits as the names queries select them: from
// pr.CommitNames when it is set, and otherwise pr's commits with null names.
func nameNodes(pr *fetch.Entry) []any {
	var out []any
	if pr.CommitNames == nil {
		for _, c := range pr.Commits {
			out = append(out, map[string]any{"commit": map[string]any{"oid": c.OID, "author": nil, "committer": nil}})
		}
		return out
	}
	for _, c := range pr.CommitNames.Commits {
		out = append(out, map[string]any{"commit": map[string]any{
			"oid": c.OID, "author": map[string]any{"name": c.Author}, "committer": map[string]any{"name": c.Committer},
		}})
	}
	return out
}

// offset decodes a cursor this server handed out.
func offset(cursor string) (int, error) {
	if cursor == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(strings.TrimPrefix(cursor, "o"))
	if err != nil {
		return 0, fmt.Errorf("bad cursor %q: %w", cursor, err)
	}
	return n, nil
}

// page returns first nodes from offset start, with the cursor of the next.
func page(nodes []any, start, first int) map[string]any {
	start = min(start, len(nodes))
	end := min(start+first, len(nodes))
	return map[string]any{
		"pageInfo": map[string]any{"hasNextPage": end < len(nodes), "endCursor": "o" + strconv.Itoa(end)},
		"nodes":    append([]any{}, nodes[start:end]...),
	}
}

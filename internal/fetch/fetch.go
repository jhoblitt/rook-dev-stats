// Package fetch walks ceph/ceph pull requests through GitHub's GraphQL API
// into the local raw cache.
package fetch

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"maps"
	"path/filepath"
	"slices"
	"strconv"
	"time"

	"github.com/jhoblitt/ceph-dev-stats/internal/ghapi"
	"github.com/jhoblitt/ceph-dev-stats/internal/record"
)

// The repository the walk reads.
const (
	Owner = "ceph"
	Name  = "ceph"
)

// WindowStart is the start of the data window: 2011-09-01, the day ceph/ceph
// was created on GitHub, three weeks before its first pull request. A
// window that starts before every pull request makes the data the whole
// history: each author's baseline of earlier pull requests is zero, and
// prior_prs counts the author's earlier records.
var WindowStart = time.Date(2011, 9, 1, 0, 0, 0, 0, time.UTC)

// Defaults for Config's zero values.
const (
	DefaultPageSize       = 25
	DefaultNestedPageSize = 50
	// authorsPerRequest is how many aliased searches one request carries.
	authorsPerRequest = 25
)

// Config is one walk's settings.
type Config struct {
	// CacheDir holds raw/, authors.json and meta.json.
	CacheDir string
	// WindowStart is the start of the data window, WindowStart when zero.
	// The baselines count each author's pull requests opened before it,
	// and meta.json's opened_in_window those opened from it on.
	WindowStart time.Time
	// Since ends the walk over recently updated pull requests at the first
	// one updated before it.
	Since time.Time
	// SinceIsDefault says Since is the default rather than the operator's
	// choice. The walk then goes back to the window start instead when the
	// cache holds entries of an older FormatVersion, so that every one of
	// them is listed and fetched again, but for those meta.json's
	// GoneEntries marks.
	SinceIsDefault bool
	// DefaultSince, when set, is the since a walk without --since would
	// have used on this run. meta.json's walk_started becomes, through
	// extract, where the next default walk starts, so a walk from a later
	// Since, which skipped the pull requests updated in between, leaves
	// meta.json as it was. Zero, as for --full, lets any Since write it.
	DefaultSince time.Time
	// Refetch fetches again, once in the walk, each listed pull request the
	// cache holds at the updatedAt the listing gives, so that an entry
	// whose content changed without moving updatedAt is replaced.
	Refetch bool
	// PageSize is the number of pull requests asked for at first; it
	// halves when a page repeatedly fails. DefaultPageSize when zero.
	PageSize int
	// NestedPageSize is the number of commits, comments, reviews, events
	// or labels asked for per page. DefaultNestedPageSize when zero.
	NestedPageSize int
	// Logger receives progress; slog.Default() when nil.
	Logger *slog.Logger
	// Now gives the walk's start time; time.Now when nil.
	Now func() time.Time
}

type walker struct {
	client   *ghapi.Client
	cfg      Config
	log      *slog.Logger
	started  time.Time
	pageSize int
	// unresolved holds the pull requests skipped because GitHub could no
	// longer resolve them; the walk and the names pass can both meet one.
	unresolved map[int]bool
	// written holds the pull requests this walk has cached.
	written map[int]bool
	// stale is staleEntries as the walk started, and marked meta.json's
	// GoneEntries then.
	stale, marked map[int]time.Time
}

// goneNamed is how many pull requests the warning about GoneEntries names.
const goneNamed = 20

// numbersPerRequest is how many pull requests one PullRequestNumbers request
// asks about.
const numbersPerRequest = 25

// unresolvedError is GitHub failing to resolve one pull request a query
// asked about, as when it was deleted after it was listed or cached.
type unresolvedError struct {
	number int
	err    error
}

func (e *unresolvedError) Error() string { return e.err.Error() }
func (e *unresolvedError) Unwrap() error { return e.err }

// skipUnresolved warns that u's pull request is skipped, and counts it, once
// in the walk.
func (w *walker) skipUnresolved(ctx context.Context, u *unresolvedError) {
	if w.unresolved[u.number] {
		return
	}
	w.unresolved[u.number] = true
	w.log.WarnContext(ctx, "skipping a pull request github cannot resolve",
		slog.Int("number", u.number),
		slog.String("error", u.Error()))
}

// Run walks pull requests into cfg.CacheDir in three phases: those updated
// since cfg.Since, most recent first; every open one; then the prior-PR
// count of each author not yet in authors.json. A pull request whose author
// is null, a deleted account's, is cached with its commits' names, and
// before the third phase the entries an older fetch cached without them are
// completed, until meta.json records that none is left. It ends by writing GitHub's
// counts to meta.json, unless cfg.Since is later than a set cfg.DefaultSince,
// when it leaves meta.json as it was and warns. A pull request already cached at the listed
// updatedAt, in the current FormatVersion, is not fetched again, so a run
// that stops early can be repeated; with cfg.Refetch it is, once in the
// walk, so a repeated refetching run starts over. While the cache holds entries of an
// older FormatVersion, a walk from a default since starts at the window
// start instead, so that it reaches them all. A pull request that GitHub
// can no longer resolve when asked about it alone, as when it was deleted
// after it was listed or cached, is skipped with a warning, its entry left
// as it was or not written, and counted in the closing log line. When a
// walk from the window start has finished, GitHub is asked by number about
// each older-format entry it left as it was; one GitHub cannot resolve is
// marked in meta.json's GoneEntries, no longer sends a default walk back,
// and is warned of and counted in the closing log line on every run.
func Run(ctx context.Context, client *ghapi.Client, cfg Config) error {
	if cfg.PageSize == 0 {
		cfg.PageSize = DefaultPageSize
	}
	if cfg.NestedPageSize == 0 {
		cfg.NestedPageSize = DefaultNestedPageSize
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.WindowStart.IsZero() {
		cfg.WindowStart = WindowStart
	}
	w := &walker{
		client: client, log: cfg.Logger, started: cfg.Now().UTC(), pageSize: cfg.PageSize,
		unresolved: map[int]bool{}, written: map[int]bool{},
	}
	if err := w.reachStale(ctx, &cfg); err != nil {
		return err
	}
	w.cfg = cfg
	w.log.InfoContext(ctx, "walk started",
		slog.Time("since", cfg.Since),
		slog.String("cache_dir", cfg.CacheDir))

	if err := w.walk(ctx, "updated", nil, cfg.Since); err != nil {
		return err
	}
	if err := w.walk(ctx, "open", []string{"OPEN"}, time.Time{}); err != nil {
		return err
	}
	if err := w.completeNames(ctx); err != nil {
		return err
	}
	if err := w.baselines(ctx); err != nil {
		return err
	}
	gone, err := w.goneEntries(ctx)
	if err != nil {
		return err
	}
	if !cfg.DefaultSince.IsZero() && cfg.Since.After(cfg.DefaultSince) {
		w.log.WarnContext(ctx, "coverage mark not advanced",
			slog.String("reason", "the walk started later than the default since, so it may have missed pull requests updated in between"),
			slog.Time("since", cfg.Since),
			slog.Time("default_since", cfg.DefaultSince),
			slog.String("path", filepath.Join(cfg.CacheDir, MetaFile)))
		w.warnGone(ctx, gone)
		w.log.InfoContext(ctx, "walk finished",
			slog.Int("unresolved", len(w.unresolved)),
			slog.Int("gone", len(gone)))
		return nil
	}
	meta, err := w.counts(ctx)
	if err != nil {
		return err
	}
	// completeNames named every entry an earlier walk left without names
	// but those GitHub can no longer resolve, which no later pass could
	// name, and store names each deleted account's entry it writes.
	meta.DeletedAuthorsNamed = true
	meta.GoneEntries = gone
	if err := writeJSON(filepath.Join(cfg.CacheDir, MetaFile), meta); err != nil {
		return err
	}
	w.warnGone(ctx, gone)
	w.log.InfoContext(ctx, "walk finished",
		slog.Int("opened_in_window", meta.OpenedInWindow),
		slog.String("opened_in_window_source", string(meta.OpenedInWindowSource)),
		slog.Int("open", meta.Open),
		slog.Int("unresolved", len(w.unresolved)),
		slog.Int("gone", len(gone)))
	return nil
}

// reachStale sets w.stale and w.marked from cfg's cache. When some stale
// entries are not marked at the same FetchedAt, it warns, and then moves a
// default cfg.Since back to cfg.WindowStart so that the walk lists, and
// fetches again, every one of them.
func (w *walker) reachStale(ctx context.Context, cfg *Config) error {
	switch m, err := ReadMeta(cfg.CacheDir); {
	case err == nil:
		w.marked = m.GoneEntries
	case !errors.Is(err, fs.ErrNotExist):
		return err
	}
	stale, err := staleEntries(cfg.CacheDir)
	if err != nil {
		return err
	}
	w.stale = stale
	unmarked := 0
	for n, fetched := range stale {
		if at, ok := w.marked[n]; !ok || !at.Equal(fetched) {
			unmarked++
		}
	}
	if unmarked == 0 {
		return nil
	}
	if cfg.SinceIsDefault {
		cfg.Since = cfg.WindowStart
	}
	w.log.WarnContext(ctx, "cache holds entries of an older format",
		slog.Int("entries", unmarked),
		slog.Int("format_version", FormatVersion),
		slog.Time("since", cfg.Since))
	return nil
}

// goneEntries is meta.json's GoneEntries after this walk. After a walk from
// the window start, GitHub is asked by number about every older-format entry
// the walk did not write, and those it cannot resolve are kept: not being
// written is no proof, since a pull request updated during the walk can
// move past the listing's cursor and go unlisted, and one that resolves is
// left unmarked for the next walk to go back for. A walk that started later
// concludes nothing of the pull requests it did not list, and keeps those
// already marked that it did not write.
func (w *walker) goneEntries(ctx context.Context) (map[int]time.Time, error) {
	gone := map[int]time.Time{}
	if w.cfg.Since.After(w.cfg.WindowStart) {
		for n, fetched := range w.stale {
			if at, ok := w.marked[n]; ok && !w.written[n] && at.Equal(fetched) {
				gone[n] = fetched
			}
		}
		return gone, nil
	}
	var left []int
	for n := range w.stale {
		if !w.written[n] {
			left = append(left, n)
		}
	}
	if len(left) == 0 {
		return gone, nil
	}
	slices.Sort(left)
	for batch := range slices.Chunk(left, numbersPerRequest) {
		missing, err := w.unresolvable(ctx, batch)
		if err != nil {
			return nil, err
		}
		for _, n := range missing {
			gone[n] = w.stale[n]
		}
	}
	w.log.InfoContext(ctx, "asked github about older-format entries the walk left",
		slog.Int("asked", len(left)),
		slog.Int("not_found", len(gone)))
	return gone, nil
}

// unresolvable asks GitHub by number about the pull requests numbers, at
// most numbersPerRequest of them, and returns those it cannot resolve.
func (w *walker) unresolvable(ctx context.Context, numbers []int) ([]int, error) {
	const what = "asking whether cached pull requests exist"
	vars := map[string]any{"owner": Owner, "name": Name}
	for i, n := range numbers {
		vars["n"+strconv.Itoa(i)] = n
	}
	var resp struct {
		Repository map[string]*struct {
			Number *int `json:"number"`
		} `json:"repository"`
	}
	err := w.client.Do(ctx, ghapi.PullRequestNumbers(len(numbers)), vars, &resp)
	missing, ok := notFoundAliases(err, len(numbers))
	if !ok {
		return nil, fmt.Errorf("%s: %w", what, err)
	}
	var out []int
	for i, n := range numbers {
		pr := resp.Repository["p"+strconv.Itoa(i)]
		switch {
		case missing[i]:
			out = append(out, n)
		case pr == nil || pr.Number == nil || *pr.Number != n:
			return nil, fmt.Errorf("%s: no answer for pull request %d in repository.p%d", what, n, i)
		}
	}
	return out, nil
}

// warnGone warns of the cached pull requests GitHub no longer has, naming
// the first goneNamed of them.
func (w *walker) warnGone(ctx context.Context, gone map[int]time.Time) {
	if len(gone) == 0 {
		return
	}
	numbers := slices.Sorted(maps.Keys(gone))
	w.log.WarnContext(ctx, "cache holds older-format entries of pull requests github no longer has",
		slog.String("reason", "after a finished walk from the window start left their entries as they were, github answered NOT_FOUND when asked for them by number; the entries are kept as they are, and no longer send a default walk back to the window start"),
		slog.Int("pull_requests", len(numbers)),
		slog.Any("numbers", numbers[:min(len(numbers), goneNamed)]))
}

// DefaultSince is where a walk starts when no --since is given: a day
// before the last walk recorded in dataDir/meta.json, so updates that
// slipped past that walk are picked up. It is the window start when there
// is no meta yet, or when the meta's window starts later, since walks of
// that window never listed a closed pull request last updated before it.
func DefaultSince(dataDir string) (time.Time, error) {
	meta, err := record.ReadMeta(dataDir)
	if errors.Is(err, fs.ErrNotExist) {
		return WindowStart, nil
	}
	if err != nil {
		return time.Time{}, err
	}
	if meta.WindowStart.After(WindowStart) {
		return WindowStart, nil
	}
	return meta.FetchedThrough.UTC().Add(-24 * time.Hour), nil
}

type pageInfo struct {
	HasNextPage bool   `json:"hasNextPage"`
	EndCursor   string `json:"endCursor"`
}

type connection[T any] struct {
	PageInfo pageInfo `json:"pageInfo"`
	Nodes    []T      `json:"nodes"`
}

type commitNode struct {
	Commit Commit `json:"commit"`
}

// commentNode and reviewNode take fullDatabaseId as GitHub sent it,
// shadowing the parsed field, so that a value that is not a number is an
// error naming its pull request rather than a page that will not decode.
type commentNode struct {
	Comment
	FullDatabaseID *string `json:"fullDatabaseId"`
}

type reviewNode struct {
	Review
	FullDatabaseID *string `json:"fullDatabaseId"`
}

// prNode is a listed pull request. Its connection fields shadow Entry's
// lists when decoding; they are pointers so that a connection missing from
// the reply, or null, is told apart from an empty one.
type prNode struct {
	Entry
	Labels        *connection[Label]       `json:"labels"`
	Commits       *connection[commitNode]  `json:"commits"`
	Comments      *connection[commentNode] `json:"comments"`
	Reviews       *connection[reviewNode]  `json:"reviews"`
	TimelineItems *connection[Event]       `json:"timelineItems"`
}

// databaseID parses a fullDatabaseId of pull request number; null is no id.
func databaseID(number int, id *string) (int64, error) {
	if id == nil {
		return 0, nil
	}
	n, err := strconv.ParseInt(*id, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("pull request %d: fullDatabaseId %q: %w", number, *id, err)
	}
	return n, nil
}

// walk lists pull requests in states (all when nil) from the most recently
// updated, storing each, until the first one updated before since.
func (w *walker) walk(ctx context.Context, phase string, states []string, since time.Time) error {
	var after string
	fetched, skipped := 0, 0
	for page := 1; ; page++ {
		conn, err := w.listPage(ctx, states, after)
		if err != nil {
			return fmt.Errorf("listing %s pull requests: %w", phase, err)
		}
		for i := range conn.Nodes {
			n := &conn.Nodes[i]
			if n.UpdatedAt.Before(since) {
				w.log.InfoContext(ctx, "reached since",
					slog.String("phase", phase),
					slog.Int("fetched", fetched),
					slog.Int("skipped", skipped))
				return nil
			}
			switch o, err := w.store(ctx, n); {
			case err != nil:
				return err
			case o == stored:
				fetched++
			case o == kept:
				skipped++
			}
		}
		w.log.InfoContext(ctx, "listed page",
			slog.String("phase", phase),
			slog.Int("page", page),
			slog.Int("page_size", w.pageSize),
			slog.Int("fetched", fetched),
			slog.Int("skipped", skipped))
		if !conn.PageInfo.HasNextPage {
			return nil
		}
		after = conn.PageInfo.EndCursor
	}
}

// listPage asks for one page, halving the page size each time GitHub gives
// no usable answer, down to one pull request.
func (w *walker) listPage(ctx context.Context, states []string, after string) (connection[prNode], error) {
	for {
		vars := map[string]any{
			"owner": Owner, "name": Name,
			"first": w.pageSize, "nested": w.cfg.NestedPageSize,
		}
		if after != "" {
			vars["after"] = after
		}
		if states != nil {
			vars["states"] = states
		}
		// Pointers, so that a reply without either key is told apart from
		// an empty last page.
		var resp struct {
			Repository *struct {
				PullRequests *connection[prNode] `json:"pullRequests"`
			} `json:"repository"`
		}
		err := w.client.Do(ctx, ghapi.PullRequests, vars, &resp)
		if errors.Is(err, ghapi.ErrUnavailable) && w.pageSize > 1 {
			w.pageSize /= 2
			w.log.WarnContext(ctx, "halving page size",
				slog.Int("page_size", w.pageSize),
				slog.String("error", err.Error()))
			continue
		}
		if err != nil {
			return connection[prNode]{}, err
		}
		if resp.Repository == nil || resp.Repository.PullRequests == nil {
			return connection[prNode]{}, errors.New("reply without repository.pullRequests")
		}
		return *resp.Repository.PullRequests, nil
	}
}

// outcome is what store did with a listed pull request.
type outcome int

const (
	stored outcome = iota
	// kept is a pull request the cache already held.
	kept
	// gone is a pull request GitHub could no longer resolve.
	gone
)

// store fetches the rest of n's connections and caches it, unless the
// cache already holds it in the current format at the same or a later
// updatedAt, or GitHub can no longer resolve it. With cfg.Refetch, one held
// at the same updatedAt is fetched again, unless this walk wrote it.
func (w *walker) store(ctx context.Context, n *prNode) (outcome, error) {
	cached, err := ReadEntry(w.cfg.CacheDir, n.Number)
	switch {
	case err == nil && cached.FormatVersion >= FormatVersion && !n.UpdatedAt.After(cached.UpdatedAt) &&
		(!w.cfg.Refetch || n.UpdatedAt.Before(cached.UpdatedAt) || w.written[n.Number]):
		return kept, nil
	case err != nil && !errors.Is(err, fs.ErrNotExist):
		return 0, err
	}
	e, err := w.download(ctx, n)
	if u, ok := errors.AsType[*unresolvedError](err); ok {
		w.skipUnresolved(ctx, u)
		return gone, nil
	}
	if err != nil {
		return 0, err
	}
	if err := writeJSON(entryPath(w.cfg.CacheDir, e.Number), e); err != nil {
		return 0, err
	}
	w.written[e.Number] = true
	w.log.DebugContext(ctx, "cached pull request",
		slog.Int("number", e.Number),
		slog.Time("updated_at", e.UpdatedAt))
	return stored, nil
}

// download asks for the rest of n's connections, and for its commits' names
// when its author is null, and returns n as the cache holds it. It is an
// *unresolvedError when GitHub can no longer resolve n.
func (w *walker) download(ctx context.Context, n *prNode) (Entry, error) {
	e := n.Entry
	var err error
	if e.Labels, err = rest(ctx, w, n.Number, ghapi.Labels, n.Labels); err != nil {
		return Entry{}, err
	}
	commits, err := rest(ctx, w, n.Number, ghapi.Commits, n.Commits)
	if err != nil {
		return Entry{}, err
	}
	e.Commits = make([]Commit, len(commits))
	for i, c := range commits {
		e.Commits[i] = c.Commit
	}
	comments, err := rest(ctx, w, n.Number, ghapi.Comments, n.Comments)
	if err != nil {
		return Entry{}, err
	}
	e.Comments = make([]Comment, len(comments))
	for i, c := range comments {
		e.Comments[i] = c.Comment
		if e.Comments[i].DatabaseID, err = databaseID(n.Number, c.FullDatabaseID); err != nil {
			return Entry{}, err
		}
	}
	reviews, err := rest(ctx, w, n.Number, ghapi.Reviews, n.Reviews)
	if err != nil {
		return Entry{}, err
	}
	e.Reviews = make([]Review, len(reviews))
	for i, r := range reviews {
		e.Reviews[i] = r.Review
		if e.Reviews[i].DatabaseID, err = databaseID(n.Number, r.FullDatabaseID); err != nil {
			return Entry{}, err
		}
	}
	if e.TimelineItems, err = rest(ctx, w, n.Number, ghapi.TimelineItems, n.TimelineItems); err != nil {
		return Entry{}, err
	}
	if e.Author == nil {
		names, unresolved, err := w.askNames(ctx, []int{n.Number})
		if err != nil {
			return Entry{}, err
		}
		if len(unresolved) > 0 {
			return Entry{}, unresolved[0]
		}
		e.CommitNames = names[n.Number]
	}

	e.Author = orGhost(e.Author)
	for i := range e.Comments {
		e.Comments[i].Author = orGhost(e.Comments[i].Author)
	}
	for i := range e.Reviews {
		e.Reviews[i].Author = orGhost(e.Reviews[i].Author)
	}
	e.FetchedAt = w.started
	e.FormatVersion = FormatVersion
	return e, nil
}

// rest returns first's nodes followed by every later page of connection c
// of pull request number. A first page or a later one that the reply left
// out, or gave as null, is an error rather than an empty last page.
func rest[T any](ctx context.Context, w *walker, number int, c ghapi.Connection, first *connection[T]) ([]T, error) {
	return pages(ctx, w, number, c, ghapi.ConnectionPage(c), first)
}

// pages is rest, asking for each later page with q, which selects c of
// repository.pullRequest. It is an *unresolvedError when GitHub can no
// longer resolve that pull request.
func pages[T any](ctx context.Context, w *walker, number int, c ghapi.Connection, q ghapi.Query, first *connection[T]) ([]T, error) {
	if first == nil {
		return nil, fmt.Errorf("listing pull request %d: reply without %s", number, c)
	}
	nodes := first.Nodes
	info := first.PageInfo
	for info.HasNextPage {
		var resp struct {
			Repository struct {
				PullRequest map[string]*connection[T] `json:"pullRequest"`
			} `json:"repository"`
		}
		vars := map[string]any{
			"owner": Owner, "name": Name, "number": number,
			"first": w.cfg.NestedPageSize, "after": info.EndCursor,
		}
		if err := w.client.Do(ctx, q, vars, &resp); err != nil {
			err = fmt.Errorf("paging %s of pull request %d: %w", c, number, err)
			if nf, ok := errors.AsType[*ghapi.NotFoundError](err); ok && slices.Equal(nf.Paths, []string{"repository.pullRequest"}) {
				return nil, &unresolvedError{number: number, err: err}
			}
			return nil, err
		}
		page := resp.Repository.PullRequest[string(c)]
		if page == nil {
			return nil, fmt.Errorf("paging %s of pull request %d: reply without repository.pullRequest.%s", c, number, c)
		}
		nodes = append(nodes, page.Nodes...)
		info = page.PageInfo
	}
	return nodes, nil
}

func orGhost(a *Actor) *Actor {
	if a == nil {
		return &Actor{Login: GhostLogin, Typename: "User"}
	}
	return a
}

// baselines records, for each human author in the cache not yet in
// authors.json, how many pull requests they opened before the window.
// Baselines asked for another window, or for none the file records, are
// asked again, every one, and authors.json is rewritten for this window
// after the first batch, or at the end when there is none to ask, so that
// it never holds counts of two windows.
func (w *walker) baselines(ctx context.Context) error {
	path := filepath.Join(w.cfg.CacheDir, AuthorsFile)
	cached, err := ReadBaselines(w.cfg.CacheDir)
	switch {
	case errors.Is(err, fs.ErrNotExist):
		cached = Baselines{WindowStart: w.cfg.WindowStart, Authors: map[string]int{}}
	case err != nil:
		return err
	case !cached.WindowStart.Equal(w.cfg.WindowStart):
		w.log.WarnContext(ctx, "asking every author's prior pull requests again",
			slog.String("reason", staleReason(cached.WindowStart)),
			slog.Time("window_start", w.cfg.WindowStart),
			slog.Int("authors", len(cached.Authors)),
			slog.String("path", path))
		cached = Baselines{WindowStart: w.cfg.WindowStart, Authors: map[string]int{}}
	}
	known := cached.Authors
	paths, err := cachedEntries(w.cfg.CacheDir)
	if err != nil {
		return err
	}
	var todo []string
	for _, p := range paths {
		e, err := readEntryFile(p)
		if err != nil {
			return err
		}
		a := e.Author
		if a == nil || a.Login == GhostLogin || a.Typename == "Bot" {
			continue
		}
		if _, ok := known[a.Login]; !ok && !slices.Contains(todo, a.Login) {
			todo = append(todo, a.Login)
		}
	}
	slices.Sort(todo)
	w.log.InfoContext(ctx, "counting prior pull requests", slog.Int("authors", len(todo)))

	before := w.cfg.WindowStart.Format(time.DateOnly)
	for batch := range slices.Chunk(todo, authorsPerRequest) {
		vars := make(map[string]any, len(batch))
		for i, login := range batch {
			vars["q"+strconv.Itoa(i)] = fmt.Sprintf("repo:%s/%s is:pr author:%s created:<%s", Owner, Name, login, before)
		}
		// Pointers, so that a missing or null answer is not a count of 0,
		// which would be kept for good.
		var resp map[string]*struct {
			IssueCount *int `json:"issueCount"`
		}
		if err := w.client.Do(ctx, ghapi.AuthorBaselines(len(batch)), vars, &resp); err != nil {
			return fmt.Errorf("counting prior pull requests: %w", err)
		}
		for i, login := range batch {
			r := resp["a"+strconv.Itoa(i)]
			if r == nil || r.IssueCount == nil {
				return fmt.Errorf("counting prior pull requests: no answer for %s", login)
			}
			known[login] = *r.IssueCount
		}
		if err := writeJSON(path, cached); err != nil {
			return err
		}
	}
	if len(todo) == 0 {
		return writeJSON(path, cached)
	}
	return nil
}

// staleReason says why baselines recorded for window are not for the
// window in force.
func staleReason(window time.Time) string {
	if window.IsZero() {
		return "the file does not record the window they were asked for"
	}
	return "they were asked for the window from " + window.Format(time.DateOnly)
}

// counts asks GitHub how many pull requests were opened in the window and
// how many are open now. A window that starts no later than the
// repository's creation holds every pull request, so the listing's total
// counts it exactly and the search is not asked; a later one only the
// search can count, and GitHub's search has been seen to omit pull requests
// its listing returns.
func (w *walker) counts(ctx context.Context) (Meta, error) {
	type total struct {
		TotalCount *int `json:"totalCount"`
	}
	// Pointers, so that a reply without a field is an error rather than a
	// count of 0 or a repository created at the zero time.
	var resp struct {
		Repository *struct {
			CreatedAt *time.Time `json:"createdAt"`
			Total     *total     `json:"total"`
			Open      *total     `json:"open"`
		} `json:"repository"`
	}
	if err := w.client.Do(ctx, ghapi.Counts, map[string]any{"owner": Owner, "name": Name}, &resp); err != nil {
		return Meta{}, fmt.Errorf("counting pull requests: %w", err)
	}
	repo := resp.Repository
	var missing string
	switch {
	case repo == nil || repo.CreatedAt == nil:
		missing = "repository.createdAt"
	case repo.Total == nil || repo.Total.TotalCount == nil:
		missing = "repository.pullRequests.totalCount"
	case repo.Open == nil || repo.Open.TotalCount == nil:
		missing = "repository.pullRequests(states: OPEN).totalCount"
	}
	if missing != "" {
		return Meta{}, fmt.Errorf("counting pull requests: reply without %s", missing)
	}
	m := Meta{
		WindowStart:          w.cfg.WindowStart,
		WalkStarted:          w.started,
		OpenedInWindow:       *repo.Total.TotalCount,
		OpenedInWindowSource: record.SourceListing,
		Open:                 *repo.Open.TotalCount,
	}
	attrs := []slog.Attr{
		slog.Time("window_start", w.cfg.WindowStart),
		slog.Time("repository_created", *repo.CreatedAt),
		slog.Int("listing_total", *repo.Total.TotalCount),
	}
	if w.cfg.WindowStart.After(*repo.CreatedAt) {
		n, err := w.searchCount(ctx)
		if err != nil {
			return Meta{}, err
		}
		m.OpenedInWindow, m.OpenedInWindowSource = n, record.SourceSearch
		attrs = append(attrs, slog.Int("search_count", n))
	}
	attrs = append(attrs, slog.String("opened_in_window_source", string(m.OpenedInWindowSource)))
	w.log.LogAttrs(ctx, slog.LevelInfo, "counted pull requests", attrs...)
	return m, nil
}

// searchCount asks GitHub's search how many pull requests were opened from
// the window start on.
func (w *walker) searchCount(ctx context.Context) (int, error) {
	const what = "counting pull requests opened in the window by GitHub's search"
	vars := map[string]any{
		"search": fmt.Sprintf("repo:%s/%s is:pr created:>=%s", Owner, Name, w.cfg.WindowStart.Format(time.DateOnly)),
	}
	var resp struct {
		Search *struct {
			IssueCount *int `json:"issueCount"`
		} `json:"search"`
	}
	if err := w.client.Do(ctx, ghapi.SearchCount, vars, &resp); err != nil {
		return 0, fmt.Errorf("%s: %w", what, err)
	}
	if resp.Search == nil || resp.Search.IssueCount == nil {
		return 0, fmt.Errorf("%s: reply without search.issueCount", what)
	}
	return *resp.Search.IssueCount, nil
}

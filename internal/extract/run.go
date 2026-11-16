package extract

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"maps"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"time"

	"github.com/jhoblitt/ceph-dev-stats/internal/fetch"
	"github.com/jhoblitt/ceph-dev-stats/internal/record"
)

// Config is one run's settings.
type Config struct {
	// CacheDir holds fetch's raw/, authors.json and meta.json.
	CacheDir string
	// DataDir holds the committed prs/, authors.json and meta.json.
	DataDir string
	// WindowStart is the start of the data window; fetch.WindowStart when
	// zero. The cache's baselines must count the pull requests opened
	// before it, since prior_prs adds the author's records from it on.
	WindowStart time.Time
	// Logger receives progress; slog.Default() when nil.
	Logger *slog.Logger
}

// entryName is a cache entry's file name; anything else in raw/, such as a
// temporary file an interrupted write left behind, is not an entry.
var entryName = regexp.MustCompile(`^(\d+)\.json$`)

// Run upserts the records in cfg.DataDir from the cache in cfg.CacheDir.
// A cached pull request replaces its record when it was updated after the
// record, or when it was updated at the same time and is in the current
// FormatVersion. So every run re-derives each record a current-format entry
// is as new as, and an entry older than its record, or as old and of an
// older format, never strips what a newer one added: such entries are
// counted in a warning instead. Every record's prior_prs is then
// recomputed, since a newly added pull request can come before others by
// the same author, and only the monthly files whose bytes change are
// rewritten. The cache's baselines are added to data/authors.json or
// replace it, as readSources decides, and the cache's meta, when it has
// one, becomes data/meta.json. Before anything is written, every baseline
// and count is checked to be for cfg.WindowStart.
func Run(ctx context.Context, cfg Config) error {
	log := cfg.Logger
	if log == nil {
		log = slog.Default()
	}
	if cfg.WindowStart.IsZero() {
		cfg.WindowStart = fetch.WindowStart
	}
	src, err := readSources(cfg)
	if err != nil {
		return err
	}
	numbers, err := cachedNumbers(cfg.CacheDir)
	if err != nil {
		return err
	}
	u, err := upsert(cfg, numbers)
	if err != nil {
		return err
	}
	if len(u.older) > 0 {
		log.WarnContext(ctx, "cache entries older than their records",
			slog.Int("entries", len(u.older)),
			slog.Int("example", u.older[0]))
	}
	if len(u.odd) > 0 {
		log.WarnContext(ctx, "event addresses without an event id",
			slog.Int("events", len(u.odd)),
			slog.String("example", u.odd[0]))
	}

	recs := slices.SortedFunc(maps.Values(u.byNumber), func(a, b record.Record) int { return cmp.Compare(a.Number, b.Number) })
	setPriorPRs(recs, src.authors, cfg.WindowStart)

	written, err := record.WriteRecords(cfg.DataDir, recs)
	if err != nil {
		return err
	}
	if src.writeAuthors {
		if _, err := record.WriteAuthors(cfg.DataDir, src.authors); err != nil {
			return err
		}
	}
	if src.meta != nil {
		if _, err := record.WriteMeta(cfg.DataDir, record.Meta{
			Repo:           fetch.Owner + "/" + fetch.Name,
			WindowStart:    cfg.WindowStart,
			FetchedThrough: utc(src.meta.WalkStarted),
			GitHubCounts: record.Counts{
				OpenedInWindow:       src.meta.OpenedInWindow,
				OpenedInWindowSource: src.meta.OpenedInWindowSource,
				Open:                 src.meta.Open,
			},
		}); err != nil {
			return err
		}
	}
	// withheld_by_domain's keys are a plain domain, "other" or "no address",
	// never a whole withheld line. A plain domain is whatever run of letters,
	// digits, dots and hyphens someone wrote after an @, so it may be a login
	// or a fragment of a name; it goes only to this local run's log, never
	// into data/.
	log.InfoContext(ctx, "extract finished",
		slog.Int("cached", len(numbers)),
		slog.Int("replaced", u.replaced),
		slog.Int("records", len(recs)),
		slog.Int("months_written", len(written)),
		slog.Any("withheld_by_domain", u.withheld))
	return nil
}

// upserted is what upsert did.
type upserted struct {
	// byNumber is every record, by pull request number.
	byNumber map[int]record.Record
	// replaced counts the records derived from the cache.
	replaced int
	// older is the pull requests, ascending, whose entry did not replace
	// their record for being older or of an older format.
	older []int
	// odd is the event addresses of the derived records that held no
	// event id.
	odd []string
	// withheld counts the disclosure lines the derived records did not
	// keep, by the key Candidates gives each: what may be an address that
	// is not a tool's, or a Co-authored-by that names more than a tool.
	withheld map[string]int
}

// upsert reads the committed records and replaces each with its cached
// pull request's by the rule Run states.
func upsert(cfg Config, numbers []int) (upserted, error) {
	existing, err := record.ReadRecords(cfg.DataDir)
	if err != nil {
		return upserted{}, err
	}
	u := upserted{
		byNumber: make(map[int]record.Record, len(existing)+len(numbers)),
		withheld: map[string]int{},
	}
	for i := range existing {
		u.byNumber[existing[i].Number] = existing[i]
	}
	for _, n := range numbers {
		e, err := fetch.ReadEntry(cfg.CacheDir, n)
		if err != nil {
			return upserted{}, err
		}
		if old, ok := u.byNumber[n]; ok && !replaces(e, old) {
			u.older = append(u.older, n)
			continue
		}
		r, withheld, err := fromEntry(e)
		if err != nil {
			return upserted{}, err
		}
		u.byNumber[n] = r
		u.replaced++
		u.odd = append(u.odd, oddAddresses(e)...)
		for domain, count := range withheld {
			u.withheld[domain] += count
		}
	}
	return u, nil
}

// replaces reports whether entry e is newer than record old, or as new and
// in the current format.
func replaces(e fetch.Entry, old record.Record) bool {
	switch utc(e.UpdatedAt).Compare(old.Updated) {
	case 1:
		return true
	case 0:
		return e.FormatVersion >= fetch.FormatVersion
	default:
		return false
	}
}

// cachedNumbers lists the pull requests in the cache, in order.
func cachedNumbers(cacheDir string) ([]int, error) {
	dir := filepath.Join(cacheDir, fetch.RawDir)
	des, err := os.ReadDir(dir)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("listing %s: %w", dir, err)
	}
	var numbers []int
	for _, de := range des {
		m := entryName.FindStringSubmatch(de.Name())
		if m == nil {
			continue
		}
		n, err := strconv.Atoi(m[1])
		if err != nil {
			return nil, fmt.Errorf("listing %s: %w", dir, err)
		}
		numbers = append(numbers, n)
	}
	slices.Sort(numbers)
	return numbers, nil
}

// sources is what Run combines with the records, all for one window.
type sources struct {
	// authors is the baselines prior_prs starts from.
	authors map[string]int
	// writeAuthors is whether authors becomes data/authors.json, which it
	// does when the cache has baselines.
	writeAuthors bool
	// meta is the cache's meta.json, nil when it has none.
	meta *fetch.Meta
}

// readSources reads the baselines and counts, refusing any that are not
// for cfg.WindowStart. A baseline counts the pull requests opened before
// the window it was asked for and prior_prs adds the records from
// cfg.WindowStart on, so a baseline of another window counts some pull
// requests twice or not at all; a count of another window is checked
// against the wrong records.
//
// Only fetch can ask them again, so the cache's authors.json or meta.json
// for another window, or recording none, is an error naming that fetch.
// data/authors.json is for data/meta.json's window_start. For this window
// the cache's baselines are added over it, since a cache started afresh
// holds only the authors it has seen. For another window, or with no
// data/meta.json, it is replaced by the cache's baselines. It is an error
// when the cache cannot replace a committed file: no meta.json in the
// cache while data/meta.json is of another window, or no authors.json in
// the cache while data/authors.json exists.
func readSources(cfg Config) (sources, error) {
	window := windowOf(cfg.WindowStart)
	fix := "run `cephstats fetch` to ask GitHub again " + window

	cachedPath := filepath.Join(cfg.CacheDir, fetch.AuthorsFile)
	cached, err := fetch.ReadBaselines(cfg.CacheDir)
	inCache := err == nil
	switch {
	case errors.Is(err, fs.ErrNotExist):
	case err != nil:
		return sources{}, err
	case !cached.WindowStart.Equal(cfg.WindowStart):
		return sources{}, fmt.Errorf("%s: the author baselines are %s, not %s: %s",
			cachedPath, windowOf(cached.WindowStart), window, fix)
	}

	var src sources
	metaPath := filepath.Join(cfg.CacheDir, fetch.MetaFile)
	m, err := fetch.ReadMeta(cfg.CacheDir)
	switch {
	case errors.Is(err, fs.ErrNotExist):
	case err != nil:
		return sources{}, err
	case !m.WindowStart.Equal(cfg.WindowStart):
		return sources{}, fmt.Errorf("%s: the counts are %s, not %s: %s",
			metaPath, windowOf(m.WindowStart), window, fix)
	default:
		src.meta = &m
	}

	committed, err := record.ReadAuthors(cfg.DataDir)
	hasCommitted := err == nil
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return sources{}, err
	}
	dataMeta, err := record.ReadMeta(cfg.DataDir)
	hasDataMeta := err == nil
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return sources{}, err
	}
	dataPath := filepath.Join(cfg.DataDir, record.MetaFile)
	switch {
	case hasDataMeta && dataMeta.WindowStart.Equal(cfg.WindowStart):
		if !hasCommitted {
			committed = map[string]int{}
		}
		maps.Copy(committed, cached.Authors)
		src.authors, src.writeAuthors = committed, inCache
		return src, nil
	case hasDataMeta && src.meta == nil:
		return sources{}, fmt.Errorf("%s is %s, not %s, and %s does not exist to replace it: %s",
			dataPath, windowOf(dataMeta.WindowStart), window, metaPath, fix)
	case hasCommitted && !inCache:
		committedWindow := "for no recorded window, there being no " + dataPath
		if hasDataMeta {
			committedWindow = windowOf(dataMeta.WindowStart)
		}
		return sources{}, fmt.Errorf("%s is %s, not %s, and %s does not exist to replace it: %s",
			filepath.Join(cfg.DataDir, record.AuthorsFile), committedWindow, window, cachedPath, fix)
	}
	src.authors = cached.Authors
	if src.authors == nil {
		src.authors = map[string]int{}
	}
	src.writeAuthors = inCache
	return src, nil
}

// windowOf names the window a file records.
func windowOf(window time.Time) string {
	if window.IsZero() {
		return "for no recorded window"
	}
	return "for the window from " + window.Format(time.DateOnly)
}

// setPriorPRs sets each record's prior_prs: its author's baseline plus the
// author's records opened at or after windowStart and before it. It stays
// nil before windowStart and for an author with no baseline, as for a bot
// or a deleted account.
func setPriorPRs(recs []record.Record, baselines map[string]int, windowStart time.Time) {
	order := make([]*record.Record, len(recs))
	for i := range recs {
		order[i] = &recs[i]
	}
	slices.SortFunc(order, func(a, b *record.Record) int {
		return cmp.Or(a.Created.Compare(b.Created), cmp.Compare(a.Number, b.Number))
	})
	inWindow := map[string]int{}
	for _, r := range order {
		r.PriorPRs = nil
		if r.Created.Before(windowStart) {
			continue
		}
		if base, ok := baselines[r.Author.Login]; ok {
			r.PriorPRs = new(base + inWindow[r.Author.Login])
		}
		inWindow[r.Author.Login]++
	}
}

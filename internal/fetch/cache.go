package fetch

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/jhoblitt/ceph-dev-stats/internal/record"
)

// GhostLogin is the login a null author is stored under: GitHub returns a
// deleted account as null, and shows it as its placeholder user "ghost".
const GhostLogin = "ghost"

// FormatVersion is the version of the entry format this package writes. An
// entry of an older version is fetched again whatever its updatedAt, so a
// change to what an entry holds reaches every cached pull request.
const FormatVersion = 1

// Actor is a pull request, comment or review author.
type Actor struct {
	Login    string `json:"login"`
	Typename string `json:"__typename"`
}

// Label is a label on a pull request.
type Label struct {
	Name string `json:"name"`
}

// Commit is one of a pull request's commits.
type Commit struct {
	OID           string    `json:"oid"`
	AuthoredDate  time.Time `json:"authoredDate"`
	CommittedDate time.Time `json:"committedDate"`
	Message       string    `json:"message"`
}

// Comment is a conversation comment on a pull request. DatabaseID is
// GitHub's fullDatabaseId, a BigInt kept as the JSON string GitHub sends;
// it is zero when GitHub gave none.
type Comment struct {
	DatabaseID int64     `json:"fullDatabaseId,string"`
	CreatedAt  time.Time `json:"createdAt"`
	Body       string    `json:"body"`
	Author     *Actor    `json:"author"`
}

// Review is a review on a pull request. SubmittedAt is nil for a pending
// review. DatabaseID is as Comment's.
type Review struct {
	DatabaseID  int64      `json:"fullDatabaseId,string"`
	SubmittedAt *time.Time `json:"submittedAt"`
	State       string     `json:"state"`
	Author      *Actor     `json:"author"`
}

// Event is a timeline event; Typename tells the kinds apart, such as
// ClosedEvent or HeadRefForcePushedEvent.
type Event struct {
	Typename  string    `json:"__typename"`
	CreatedAt time.Time `json:"createdAt"`
	// URL is the event's address on GitHub, ending in #event-<id>. A
	// ReopenedEvent has none.
	URL string `json:"url,omitzero"`
	// Commit is a MergedEvent's merge commit.
	Commit *CommitRef `json:"commit,omitzero"`
	// BeforeCommit and AfterCommit are a HeadRefForcePushedEvent's head
	// before and after the push. GitHub gives null for a commit it no
	// longer has.
	BeforeCommit *CommitRef `json:"beforeCommit,omitzero"`
	AfterCommit  *CommitRef `json:"afterCommit,omitzero"`
}

// CommitRef names a commit by its SHA.
type CommitRef struct {
	OID string `json:"oid"`
}

// Entry is one cached pull request, .cache/raw/<number>.json: GitHub's node
// with every nested connection paged to the end and flattened to a list,
// plus the start time of the walk that fetched it. In the cache every
// Author is non-nil.
type Entry struct {
	Number            int        `json:"number"`
	Title             string     `json:"title"`
	Body              string     `json:"body"`
	State             string     `json:"state"`
	IsDraft           bool       `json:"isDraft"`
	CreatedAt         time.Time  `json:"createdAt"`
	UpdatedAt         time.Time  `json:"updatedAt"`
	ClosedAt          *time.Time `json:"closedAt"`
	MergedAt          *time.Time `json:"mergedAt"`
	BaseRefName       string     `json:"baseRefName"`
	Additions         int        `json:"additions"`
	Deletions         int        `json:"deletions"`
	ChangedFiles      int        `json:"changedFiles"`
	AuthorAssociation string     `json:"authorAssociation"`
	Author            *Actor     `json:"author"`
	Labels            []Label    `json:"labels"`
	Commits           []Commit   `json:"commits"`
	Comments          []Comment  `json:"comments"`
	Reviews           []Review   `json:"reviews"`
	TimelineItems     []Event    `json:"timelineItems"`
	// CommitNames is set only for a pull request whose author is null, and
	// nil for one fetched before entries carried names until fetch
	// completes it, or for good when GitHub could no longer resolve the
	// pull request by then.
	CommitNames *CommitNames `json:"commitNames,omitzero"`
	FetchedAt   time.Time    `json:"fetchedAt"`
	// FormatVersion is the FormatVersion of the fetch that wrote the
	// entry, and zero in an entry written before entries carried one.
	FormatVersion int `json:"formatVersion"`
}

// Meta is .cache/meta.json, written at the end of a complete walk.
type Meta struct {
	// WindowStart is the window OpenedInWindow was counted from. It is
	// zero in a meta.json written before meta.json recorded it.
	WindowStart    time.Time `json:"window_start"`
	WalkStarted    time.Time `json:"walk_started"`
	OpenedInWindow int       `json:"opened_in_window"`
	// OpenedInWindowSource is which of GitHub's counts OpenedInWindow is:
	// the listing's total when the window starts no later than the
	// repository's creation, and otherwise the search's.
	OpenedInWindowSource record.CountSource `json:"opened_in_window_source,omitzero"`
	Open                 int                `json:"open"`
	// DeletedAuthorsNamed is whether every cached entry whose author is
	// null holds its CommitNames, but for those whose pull requests GitHub
	// could no longer resolve when asked. It is false in a meta.json
	// written before entries carried them, and then the next walk completes
	// the cache.
	DeletedAuthorsNamed bool `json:"deleted_authors_named,omitzero"`
	// GoneEntries is the entries of an older FormatVersion whose pull
	// requests GitHub no longer has, by number: those the last walk from the
	// window start to finish left as they were, and GitHub then answered
	// NOT_FOUND for when asked about them by number. Each is the entry's
	// FetchedAt, so that a mark no longer matches once a walk writes the
	// entry again. They are kept as they are, and no longer send a default
	// walk back to the window start.
	GoneEntries map[int]time.Time `json:"gone_entries,omitempty"`
}

// ReadMeta reads cacheDir/meta.json. A meta.json written before it recorded
// OpenedInWindowSource reads as counted by the search, as every count then
// was. A missing file is an error that matches fs.ErrNotExist.
func ReadMeta(cacheDir string) (Meta, error) {
	var m Meta
	if err := ReadJSON(filepath.Join(cacheDir, MetaFile), &m); err != nil {
		return Meta{}, err
	}
	m.OpenedInWindowSource = m.OpenedInWindowSource.OrSearch()
	return m, nil
}

// Baselines is .cache/authors.json: each author's count of pull requests
// opened before WindowStart. The window is written in the same file as the
// counts so that the two can never disagree: a count asked for one window
// is wrong for any other.
type Baselines struct {
	// WindowStart is zero in an authors.json written before authors.json
	// recorded it, which was a bare map of login to count.
	WindowStart time.Time      `json:"window_start"`
	Authors     map[string]int `json:"authors"`
}

// ReadBaselines reads cacheDir/authors.json. A missing file is an error
// that matches fs.ErrNotExist.
func ReadBaselines(cacheDir string) (Baselines, error) {
	path := filepath.Join(cacheDir, AuthorsFile)
	var fields map[string]json.RawMessage
	if err := ReadJSON(path, &fields); err != nil {
		return Baselines{}, err
	}
	b := Baselines{Authors: map[string]int{}}
	// window_start cannot be a login, since GitHub logins have no
	// underscore, so only the current format has it.
	window, ok := fields["window_start"]
	if !ok {
		for login, raw := range fields {
			var n int
			if err := json.Unmarshal(raw, &n); err != nil {
				return Baselines{}, fmt.Errorf("decoding %s: %s: %w", path, login, err)
			}
			b.Authors[login] = n
		}
		return b, nil
	}
	if err := json.Unmarshal(window, &b.WindowStart); err != nil {
		return Baselines{}, fmt.Errorf("decoding %s: window_start: %w", path, err)
	}
	if authors, ok := fields["authors"]; ok {
		if err := json.Unmarshal(authors, &b.Authors); err != nil {
			return Baselines{}, fmt.Errorf("decoding %s: authors: %w", path, err)
		}
	}
	if b.Authors == nil {
		b.Authors = map[string]int{}
	}
	return b, nil
}

// Names under a cache directory.
const (
	// RawDir holds the entries.
	RawDir = "raw"
	// AuthorsFile holds Baselines.
	AuthorsFile = "authors.json"
	// MetaFile holds Meta.
	MetaFile = "meta.json"
)

// ReadEntry reads the cached entry for pull request number. A missing entry
// is an error that matches fs.ErrNotExist.
func ReadEntry(cacheDir string, number int) (Entry, error) {
	return readEntryFile(entryPath(cacheDir, number))
}

func entryPath(cacheDir string, number int) string {
	return filepath.Join(cacheDir, RawDir, strconv.Itoa(number)+".json")
}

func readEntryFile(path string) (Entry, error) {
	var e Entry
	if err := ReadJSON(path, &e); err != nil {
		return Entry{}, err
	}
	return e, nil
}

// cachedEntries returns the paths of every entry in the cache, skipping
// the temporary files an interrupted write leaves behind.
func cachedEntries(cacheDir string) ([]string, error) {
	dir := filepath.Join(cacheDir, RawDir)
	des, err := os.ReadDir(dir)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("listing %s: %w", dir, err)
	}
	var paths []string
	for _, de := range des {
		if name := de.Name(); strings.HasSuffix(name, ".json") && !strings.HasPrefix(name, ".") {
			paths = append(paths, filepath.Join(dir, name))
		}
	}
	return paths, nil
}

// staleEntries returns the cache's entries written in an older
// FormatVersion, by pull request number, each as its FetchedAt.
func staleEntries(cacheDir string) (map[int]time.Time, error) {
	paths, err := cachedEntries(cacheDir)
	if err != nil {
		return nil, err
	}
	stale := map[int]time.Time{}
	for _, p := range paths {
		var v struct {
			Number        int       `json:"number"`
			FetchedAt     time.Time `json:"fetchedAt"`
			FormatVersion int       `json:"formatVersion"`
		}
		if err := ReadJSON(p, &v); err != nil {
			return nil, err
		}
		if v.FormatVersion < FormatVersion {
			stale[v.Number] = v.FetchedAt
		}
	}
	return stale, nil
}

// ReadJSON decodes the JSON file at path into v. A missing file is an error
// that matches fs.ErrNotExist.
func ReadJSON(path string, v any) error {
	b, err := os.ReadFile(path) //nolint:gosec // the cache and data directories are the operator's to name
	if err != nil {
		return fmt.Errorf("reading %s: %w", path, err)
	}
	if err := json.Unmarshal(b, v); err != nil {
		return fmt.Errorf("decoding %s: %w", path, err)
	}
	return nil
}

// writeJSON replaces path with v through a temporary file and a rename, so
// a reader never sees a partial file.
func writeJSON(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return fmt.Errorf("encoding %s: %w", path, err)
	}
	dir := filepath.Dir(path)
	if err = os.MkdirAll(dir, 0o750); err != nil {
		return fmt.Errorf("creating %s: %w", dir, err)
	}
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(path)+".*.tmp")
	if err != nil {
		return fmt.Errorf("writing %s: %w", path, err)
	}
	if err = replace(tmp, append(b, '\n'), path); err != nil {
		return fmt.Errorf("writing %s: %w", path, errors.Join(err, os.Remove(tmp.Name())))
	}
	return nil
}

// replace fills tmp with b and renames it to path.
func replace(tmp *os.File, b []byte, path string) error {
	if _, err := tmp.Write(b); err != nil {
		return errors.Join(err, tmp.Close())
	}
	if err := tmp.Sync(); err != nil {
		return errors.Join(err, tmp.Close())
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}

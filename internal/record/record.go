// Package record owns the committed data: one record per pull request in
// monthly JSON-lines files under data/prs, and data/meta.json and
// data/authors.json beside them.
package record

import "time"

// Names under the data directory.
const (
	PRsDir      = "prs"
	MetaFile    = "meta.json"
	AuthorsFile = "authors.json"
)

// Pull request states.
const (
	StateOpen   = "open"
	StateMerged = "merged"
	StateClosed = "closed"
)

// Lifecycle event kinds.
const (
	KindReady     = "ready"
	KindDraft     = "draft"
	KindForcePush = "force_push"
	KindClosed    = "closed"
	KindReopened  = "reopened"
	KindMerged    = "merged"
)

// Review states.
const (
	ReviewApproved         = "approved"
	ReviewChangesRequested = "changes_requested"
	ReviewCommented        = "commented"
	ReviewDismissed        = "dismissed"
)

// Record is one pull request as committed. Times are UTC to the second.
// Events, Reviews and Comments are in time order, Labels in name order,
// Commits.List in GitHub's order and each Disclosure list in order of first
// appearance. Labels, Events, Reviews, Comments and the Disclosure lists are
// empty rather than null; Commits.List is left out when nil, and KindHints
// when the pull request gives no hint.
type Record struct {
	Number      int       `json:"number"`
	Updated     time.Time `json:"updated"`
	Title       string    `json:"title"`
	Author      Actor     `json:"author"`
	Association string    `json:"association"`
	Base        string    `json:"base"`
	Created     time.Time `json:"created"`
	State       string    `json:"state"`
	// Draft is whether the pull request is a draft now.
	Draft     bool     `json:"draft"`
	Additions int      `json:"additions"`
	Deletions int      `json:"deletions"`
	Files     int      `json:"files"`
	Labels    []string `json:"labels"`
	Commits   Commits  `json:"commits"`
	// PriorPRs is the author's count of pull requests opened in rook/rook
	// before this one. It is nil when the author has no baseline in
	// authors.json, as for a bot or a deleted account, and for a pull
	// request opened before the window start.
	PriorPRs   *int       `json:"prior_prs"`
	Events     []Event    `json:"events"`
	Reviews    []Review   `json:"reviews"`
	Comments   []Comment  `json:"comments"`
	Disclosure Disclosure `json:"disclosure"`
	// KindHints is nil when the pull request gives no hint.
	KindHints *KindHints `json:"kind_hints,omitempty"`
}

// Actor is an account; Bot is GitHub's own typing of it.
type Actor struct {
	Login string `json:"login"`
	Bot   bool   `json:"bot"`
	// Name is set only on the author of a pull request opened by an account
	// since deleted, whose Login is GitHub's placeholder ghost: the name its
	// commits credit, by fetch's CommitNames.Name. It is empty when they
	// give none or were not read, and for every other account.
	Name string `json:"name,omitzero"`
}

// Commits summarizes a pull request's commits. The times are nil when it
// has none.
type Commits struct {
	Count int `json:"count"`
	// FirstAuthored is the earliest author date.
	FirstAuthored *time.Time `json:"first_authored"`
	// LastCommitted is the latest committer date.
	LastCommitted *time.Time `json:"last_committed"`
	// List is every commit, in the order GitHub gives them. It is nil in a
	// record written before records carried it.
	List []Commit `json:"list,omitzero"`
}

// Commit is one commit of a pull request. SHA is empty when the cache did
// not have it.
type Commit struct {
	SHA       string    `json:"sha,omitzero"`
	Authored  time.Time `json:"authored"`
	Committed time.Time `json:"committed"`
}

// Event is a lifecycle event; Kind is one of the Kind constants. ID is the
// number in the event's GitHub address, #event-<id>, which a reopening
// does not have. SHA is the merge commit of a merge and the pushed commit
// of a force-push. Either is zero when there is nothing to hold.
type Event struct {
	At   time.Time `json:"at"`
	Kind string    `json:"kind"`
	ID   int64     `json:"id,omitzero"`
	SHA  string    `json:"sha,omitzero"`
}

// Review is a submitted review; State is one of the Review constants. ID
// is GitHub's database id, zero when the cache did not have it.
type Review struct {
	At    time.Time `json:"at"`
	ID    int64     `json:"id,omitzero"`
	By    string    `json:"by"`
	Bot   bool      `json:"bot"`
	State string    `json:"state"`
}

// Comment is a conversation comment. ID is GitHub's database id, zero when
// the cache did not have it. Text is kept only for a comment that, after
// trimming, is a single line of at most 80 characters with no "@" in it
// but a leading mention of Mergify or Dependabot, since any other mention
// or an e-mail address names a person; it is empty otherwise.
type Comment struct {
	At   time.Time `json:"at"`
	ID   int64     `json:"id,omitzero"`
	By   string    `json:"by"`
	Bot  bool      `json:"bot"`
	Text string    `json:"text,omitempty"`
}

// Disclosure holds the lines that might disclose LLM use: candidates, not
// verdicts, each list de-duplicated in order of first appearance.
type Disclosure struct {
	Trailers    []string `json:"trailers"`
	Description []string `json:"description"`
	CommitProse []string `json:"commit_prose"`
	// Checklist is whether the description ticks the PR template's
	// AI-guidelines box.
	Checklist bool `json:"checklist,omitempty"`
}

// Meta is data/meta.json.
type Meta struct {
	Repo        string    `json:"repo"`
	WindowStart time.Time `json:"window_start"`
	// FetchedThrough is when the last complete walk began.
	FetchedThrough time.Time `json:"fetched_through"`
	GitHubCounts   Counts    `json:"github_counts"`
}

// Counts are GitHub's own counts, taken at the end of the last walk. Open
// is always the listing's.
type Counts struct {
	OpenedInWindow int `json:"opened_in_window"`
	// OpenedInWindowSource is empty in a meta.json written before
	// meta.json recorded it, when OpenedInWindow was always the search's.
	OpenedInWindowSource CountSource `json:"opened_in_window_source,omitzero"`
	Open                 int         `json:"open"`
}

// CountSource names which of GitHub's counts a count is.
type CountSource string

const (
	// SourceListing is the totalCount of the repository's pull-request
	// listing, which counts every pull request it holds.
	SourceListing CountSource = "listing"
	// SourceSearch is the issueCount of a search for the pull requests
	// created from the window start on. GitHub's search has been seen to
	// omit pull requests its listing returns.
	SourceSearch CountSource = "search"
)

// OrSearch is s, or SourceSearch when s is empty, as it is in a file
// written before the source was recorded.
func (s CountSource) OrSearch() CountSource {
	if s == "" {
		return SourceSearch
	}
	return s
}

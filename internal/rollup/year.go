package rollup

import (
	"cmp"
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"time"

	"github.com/jhoblitt/rook-dev-stats/internal/classify"
	"github.com/jhoblitt/rook-dev-stats/internal/record"
)

// year is the three files of the pull requests filed under one year, each a
// set of columns of equal length.
type year struct {
	prs    prsFile
	events eventsFile
	table  tableFile
}

type prsFile struct {
	Number        []int   `json:"number"`
	Created       []int64 `json:"created"`
	Ready         []int64 `json:"ready"`
	Closed        []int64 `json:"closed"`
	State         []int   `json:"state"`
	Base          []int   `json:"base"`
	Draft         []int   `json:"draft"`
	OpenedDraft   []int   `json:"opened_draft"`
	Reopened      []int   `json:"reopened"`
	InWindow      []int   `json:"in_window"`
	Additions     []int   `json:"additions"`
	Deletions     []int   `json:"deletions"`
	Files         []int   `json:"files"`
	Commits       []int   `json:"commits"`
	FirstCommit   []int64 `json:"first_commit"`
	LastCommit    []int64 `json:"last_commit"`
	FirstResponse []int64 `json:"first_response"`
	FirstApproval []int64 `json:"first_approval"`
	HumanReviews  []int   `json:"human_reviews"`
	BotReviews    []int   `json:"bot_reviews"`
	BotCommands   []int   `json:"bot_commands"`
	Disclosure    []int   `json:"disclosure"`
	Families      [][]int `json:"families"`
	Components    [][]int `json:"components"`
	Standing      []int   `json:"standing"`
	Kind          []int   `json:"kind"`
	Author        []int   `json:"author"`
	// BackportLink is 1 for a pull request whose description links the
	// one it backports, the flag the site filters on without its table.
	BackportLink []int `json:"backport_link"`
}

type eventsFile struct {
	PR    []int   `json:"pr"`
	At    []int64 `json:"at"`
	Kind  []int   `json:"kind"`
	Sub   []int   `json:"sub"`
	Actor []int   `json:"actor"`
}

type tableFile struct {
	Titles  []string `json:"titles"`
	Authors []string `json:"authors"`
	// Commits are each row's [sha, authored, committed].
	Commits [][][]any `json:"commits"`
	// Refs are one per event, in the events file's order.
	Refs       []string `json:"refs"`
	Tickets    [][]int  `json:"tickets"`
	BackportOf []int    `json:"backport_of"`
	KindSource []string `json:"kind_source"`
}

func newYear() *year {
	return &year{events: eventsFile{
		PR: []int{}, At: []int64{}, Kind: []int{}, Sub: []int{}, Actor: []int{},
	}, table: tableFile{Refs: []string{}}}
}

// event is one row of an events file before its person is indexed.
type event struct {
	at   int64
	kind string
	// sub is the command's index for a command, else -1.
	sub int
	// actor is the login an actor index names, or "" for none.
	actor string
	ref   string
}

var sha = regexp.MustCompile(`^[0-9a-f]{40}$`)

// mergeCloseLag is how long after a merge GitHub may record the close the
// merge itself caused: in the data, at the merge's second or the next.
const mergeCloseLag = 5 * time.Second

func (b *builder) add(r *record.Record, p *classify.PR) error {
	state, ok := states[r.State]
	if !ok {
		return fmt.Errorf("pull request %d has the state %q, which is not open, merged or closed", r.Number, r.State)
	}
	events, err := b.events(r, p)
	if err != nil {
		return err
	}
	fy := b.fileYear(r)
	y, ok := b.years[fy]
	if !ok {
		y = newYear()
		b.years[fy] = y
	}
	row := len(y.prs.Number)
	b.index.Numbers = append(b.index.Numbers, r.Number)
	b.index.Years = append(b.index.Years, fy)

	author := b.author(r, p.AuthorHuman)
	for _, e := range events {
		actor := -1
		if e.actor != "" {
			actor = b.person(e.actor, false)
		}
		y.events.PR = append(y.events.PR, row)
		y.events.At = append(y.events.At, e.at)
		y.events.Kind = append(y.events.Kind, b.eventKinds[e.kind])
		y.events.Sub = append(y.events.Sub, e.sub)
		y.events.Actor = append(y.events.Actor, actor)
		y.table.Refs = append(y.table.Refs, e.ref)
	}

	openedDraft, ready := readiness(r)
	response, approval := responses(r, p, ready)
	humanReviews, botReviews := 0, 0
	for _, v := range p.Reviews {
		switch {
		case v.Other:
			humanReviews++
		case !v.Human:
			botReviews++
		}
	}
	commands := 0
	for _, v := range p.Comments {
		if v.Command != "" {
			commands++
		}
	}
	kind, source := -1, ""
	if k, ok := b.kinds[p.Kind]; ok {
		kind, source = k, p.KindSource
	}

	f := &y.prs
	f.Number = append(f.Number, r.Number)
	f.Created = append(f.Created, epoch(r.Created))
	f.Ready = append(f.Ready, ready)
	f.Closed = append(f.Closed, closedAt(r))
	f.State = append(f.State, state)
	f.Base = append(f.Base, b.bases[r.Base])
	f.Draft = append(f.Draft, flag(r.Draft))
	f.OpenedDraft = append(f.OpenedDraft, flag(openedDraft))
	f.Reopened = append(f.Reopened, count(r.Events, record.KindReopened))
	f.InWindow = append(f.InWindow, flag(!r.Created.Before(b.windowStart)))
	f.Additions = append(f.Additions, r.Additions)
	f.Deletions = append(f.Deletions, r.Deletions)
	f.Files = append(f.Files, r.Files)
	f.Commits = append(f.Commits, r.Commits.Count)
	f.FirstCommit = append(f.FirstCommit, firstCommit(r))
	f.LastCommit = append(f.LastCommit, lastCommit(r))
	f.FirstResponse = append(f.FirstResponse, response)
	f.FirstApproval = append(f.FirstApproval, approval)
	f.HumanReviews = append(f.HumanReviews, humanReviews)
	f.BotReviews = append(f.BotReviews, botReviews)
	f.BotCommands = append(f.BotCommands, commands)
	f.Disclosure = append(f.Disclosure, slices.Index(classify.DisclosureClasses(), p.Disclosure))
	f.Families = append(f.Families, indexes(b.families, p.Families))
	f.Components = append(f.Components, indexes(b.components, p.Components))
	f.Standing = append(f.Standing, standing(r))
	f.Kind = append(f.Kind, kind)
	f.Author = append(f.Author, author)
	f.BackportLink = append(f.BackportLink, flag(backportOf(r) > 0))

	t := &y.table
	t.Titles = append(t.Titles, r.Title)
	t.Authors = append(t.Authors, r.Author.Login)
	t.Commits = append(t.Commits, commitList(r))
	t.Tickets = append(t.Tickets, tickets(r))
	t.BackportOf = append(t.BackportOf, backportOf(r))
	t.KindSource = append(t.KindSource, source)
	return nil
}

// events are r's comments, reviews and lifecycle events in time order,
// leaving out the close GitHub records for a merge, which is the merge
// rather than a second disposition, and writing a merged pull request's
// last close as its merge when GitHub recorded no merge. Those at the same
// second keep the order comments, reviews, lifecycle events.
func (b *builder) events(r *record.Record, p *classify.PR) ([]event, error) {
	evs := make([]event, 0, len(r.Comments)+len(r.Reviews)+len(r.Events))
	for i, c := range r.Comments {
		v := p.Comments[i]
		e := event{at: epoch(c.At), kind: v.Kind, sub: -1, ref: id(c.ID)}
		switch v.Kind {
		case classify.CommandAuthor, classify.CommandOther:
			e.sub = b.commands[v.Command]
		case classify.CommentOther:
			e.actor = c.By
		}
		evs = append(evs, e)
	}
	for i, rv := range r.Reviews {
		e := event{at: epoch(rv.At), kind: botReview, sub: -1, ref: id(rv.ID)}
		switch v := p.Reviews[i]; {
		case v.Other:
			kind, err := reviewKind(r.Number, rv.State)
			if err != nil {
				return nil, err
			}
			e.kind, e.actor = kind, rv.By
		case v.Human:
			e.kind = reviewAuthor
		}
		evs = append(evs, e)
	}
	var merges []time.Time
	for _, le := range r.Events {
		if le.Kind == record.KindMerged {
			merges = append(merges, le.At)
		}
	}
	causedByMerge := func(at time.Time) bool {
		return slices.ContainsFunc(merges, func(m time.Time) bool {
			return !at.Before(m) && at.Sub(m) <= mergeCloseLag
		})
	}
	// GitHub can mark a pull request merged and record only its close; that
	// last close is the merge, and a merge's ref is a SHA, of which it has
	// none.
	unrecordedMerge := -1
	if r.State == record.StateMerged && len(merges) == 0 {
		for i, le := range r.Events {
			if le.Kind == record.KindClosed && (unrecordedMerge == -1 || !le.At.Before(r.Events[unrecordedMerge].At)) {
				unrecordedMerge = i
			}
		}
	}
	for i, le := range r.Events {
		if !slices.Contains(lifecycleKinds, le.Kind) {
			return nil, fmt.Errorf("pull request %d has a lifecycle event of kind %q, which is not one a record holds", r.Number, le.Kind)
		}
		if le.Kind == record.KindClosed && causedByMerge(le.At) {
			continue
		}
		e := event{at: epoch(le.At), kind: le.Kind, sub: -1, ref: id(le.ID)}
		switch {
		case i == unrecordedMerge:
			e.kind, e.ref = record.KindMerged, ""
		case le.Kind == record.KindMerged || le.Kind == record.KindForcePush:
			e.ref = commitRef(le.SHA)
		}
		evs = append(evs, e)
	}
	slices.SortStableFunc(evs, func(a, b event) int { return cmp.Compare(a.at, b.at) })
	return evs, nil
}

// reviewKind is the event kind of a review by a human other than the
// author. A dismissed review no longer carries a verdict, so it counts as
// a comment.
func reviewKind(number int, state string) (string, error) {
	switch state {
	case record.ReviewApproved:
		return reviewApproved, nil
	case record.ReviewChangesRequested:
		return reviewChanges, nil
	case record.ReviewCommented, record.ReviewDismissed:
		return reviewCommented, nil
	}
	return "", fmt.Errorf("pull request %d has a review in the state %q, which the site does not know", number, state)
}

// readiness is whether r was opened as a draft, and when it was first ready
// for review: the opening, the first ready event of a draft, or -1 for a
// draft never made ready.
func readiness(r *record.Record) (openedDraft bool, ready int64) {
	for _, e := range r.Events {
		switch e.Kind {
		case record.KindReady:
			return true, epoch(e.At)
		case record.KindDraft:
			return false, epoch(r.Created)
		}
	}
	if r.Draft {
		return true, -1
	}
	return false, epoch(r.Created)
}

// responses are the first response and the first approval by a human
// other than the author. One before ready is written as ready, since the
// waiting clock had not started; with no ready, both are -1.
func responses(r *record.Record, p *classify.PR, ready int64) (response, approval int64) {
	response, approval = -1, -1
	if ready == -1 {
		return response, approval
	}
	earliest := func(cur, at int64) int64 {
		at = max(at, ready)
		if cur == -1 {
			return at
		}
		return min(cur, at)
	}
	for i, c := range r.Comments {
		if p.Comments[i].Kind == classify.CommentOther {
			response = earliest(response, epoch(c.At))
		}
	}
	for i, rv := range r.Reviews {
		if !p.Reviews[i].Other {
			continue
		}
		response = earliest(response, epoch(rv.At))
		if rv.State == record.ReviewApproved {
			approval = earliest(approval, epoch(rv.At))
		}
	}
	return response, approval
}

// fileYear is the UTC year whose files hold r: that of its final
// disposition, or, while it is open, that of fetched_through. A view of a
// period then needs only the years from the period's start onward, since a
// pull request finished before that year cannot be active in it.
func (b *builder) fileYear(r *record.Record) int {
	if r.State == record.StateOpen {
		return b.fetchedYear
	}
	return time.Unix(closedAt(r), 0).UTC().Year()
}

// closedAt is the final disposition: the last merge or close of a pull
// request that is not open, else -1. GitHub can report a pull request
// closed and return no event for it; the record keeps no close time of its
// own, so its last update stands in rather than leaving a finished pull
// request without one.
func closedAt(r *record.Record) int64 {
	last := int64(-1)
	if r.State == record.StateOpen {
		return last
	}
	for _, e := range r.Events {
		if e.Kind == record.KindMerged || e.Kind == record.KindClosed {
			last = max(last, epoch(e.At))
		}
	}
	if last == -1 {
		return epoch(r.Updated)
	}
	return last
}

// firstCommit is the earliest author date, or -1 when it is after the
// opening: the history was rewritten and the development time is unknown.
func firstCommit(r *record.Record) int64 {
	if f := r.Commits.FirstAuthored; f != nil && !f.After(r.Created) {
		return epoch(*f)
	}
	return -1
}

func lastCommit(r *record.Record) int64 {
	if l := r.Commits.LastCommitted; l != nil {
		return epoch(*l)
	}
	return -1
}

func standing(r *record.Record) int {
	if r.PriorPRs == nil {
		return -1
	}
	return *r.PriorPRs
}

func commitList(r *record.Record) [][]any {
	list := [][]any{}
	for _, c := range r.Commits.List {
		if sha.MatchString(c.SHA) {
			list = append(list, []any{c.SHA, epoch(c.Authored), epoch(c.Committed)})
		}
	}
	return list
}

func tickets(r *record.Record) []int {
	out := []int{}
	if r.KindHints != nil {
		for _, t := range r.KindHints.Tickets {
			if t > 0 {
				out = append(out, t)
			}
		}
	}
	return out
}

func backportOf(r *record.Record) int {
	if r.KindHints == nil {
		return 0
	}
	return max(r.KindHints.BackportOf, 0)
}

// indexes are the indexes of ids in a dictionary, ascending.
func indexes(dict map[string]int, ids []string) []int {
	out := make([]int, 0, len(ids))
	for _, s := range ids {
		if i, ok := dict[s]; ok {
			out = append(out, i)
		}
	}
	slices.Sort(out)
	return out
}

func count(events []record.Event, kind string) int {
	n := 0
	for _, e := range events {
		if e.Kind == kind {
			n++
		}
	}
	return n
}

// id is a GitHub id in decimal, or "" for none.
func id(n int64) string {
	if n <= 0 {
		return ""
	}
	return strconv.FormatInt(n, 10)
}

// commitRef is a SHA the site can link to, or "".
func commitRef(s string) string {
	if sha.MatchString(s) {
		return s
	}
	return ""
}

func flag(b bool) int {
	if b {
		return 1
	}
	return 0
}

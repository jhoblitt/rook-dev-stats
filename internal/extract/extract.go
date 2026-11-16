// Package extract turns the pull requests in the raw cache into the
// committed records.
package extract

import (
	"fmt"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/jhoblitt/rook-dev-stats/internal/fetch"
	"github.com/jhoblitt/rook-dev-stats/internal/record"
)

// maxCommentText is the most characters a comment may have, on one line
// after trimming, for its text to be kept: enough for any bot command.
const maxCommentText = 80

// commandBots are the handles a kept text may start by mentioning: a
// mention of a bot account names no person, and any second `@` (an address
// or a person's mention) still drops the text.
var commandBots = []string{"mergifyio", "mergify", "dependabot"}

var states = map[string]string{
	"OPEN":   record.StateOpen,
	"MERGED": record.StateMerged,
	"CLOSED": record.StateClosed,
}

var eventKinds = map[string]string{
	"ReadyForReviewEvent":     record.KindReady,
	"ConvertToDraftEvent":     record.KindDraft,
	"HeadRefForcePushedEvent": record.KindForcePush,
	"ClosedEvent":             record.KindClosed,
	"ReopenedEvent":           record.KindReopened,
	"MergedEvent":             record.KindMerged,
}

// FromEntry turns one cached pull request into its record. PriorPRs is
// left nil: it depends on the other records.
func FromEntry(e fetch.Entry) (record.Record, error) {
	r, _, err := fromEntry(e)
	return r, err
}

// fromEntry is FromEntry, also returning what Candidates withheld.
func fromEntry(e fetch.Entry) (r record.Record, withheld map[string]int, err error) {
	state, ok := states[e.State]
	if !ok {
		return record.Record{}, nil, fmt.Errorf("pull request %d: unknown state %q", e.Number, e.State)
	}
	events, err := lifecycle(e.TimelineItems)
	if err != nil {
		return record.Record{}, nil, fmt.Errorf("pull request %d: %w", e.Number, err)
	}
	messages := make([]string, len(e.Commits))
	for i, c := range e.Commits {
		messages[i] = c.Message
	}
	disclosure, withheld := Candidates(messages, e.Body)
	return record.Record{
		Number:      e.Number,
		Updated:     utc(e.UpdatedAt),
		Title:       e.Title,
		Author:      author(e),
		Association: strings.ToLower(e.AuthorAssociation),
		Base:        e.BaseRefName,
		Created:     utc(e.CreatedAt),
		State:       state,
		Draft:       e.IsDraft,
		Additions:   e.Additions,
		Deletions:   e.Deletions,
		Files:       e.ChangedFiles,
		Labels:      labels(e.Labels),
		Commits:     commits(e.Commits),
		Events:      events,
		Reviews:     reviews(e.Reviews),
		Comments:    comments(e.Comments),
		Disclosure:  disclosure,
		KindHints:   Hints(e.Number, e.Title, messages, e.Body, closingIssues(e.ClosingIssues)),
	}, withheld, nil
}

// utc is t as the records hold every time: UTC, to the second.
func utc(t time.Time) time.Time {
	return t.UTC().Truncate(time.Second)
}

// actor is a's record form; a null author is GitHub's ghost.
func actor(a *fetch.Actor) record.Actor {
	if a == nil {
		return record.Actor{Login: fetch.GhostLogin}
	}
	return record.Actor{Login: a.Login, Bot: a.Typename == "Bot"}
}

// author is e's author, named by its commits when the account was deleted.
// Only the pull request's author is: GitHub gives a deleted account's
// comment or review no commits to name it by.
func author(e fetch.Entry) record.Actor {
	a := actor(e.Author)
	if a.Login == fetch.GhostLogin {
		a.Name = e.CommitNames.Name()
	}
	return a
}

// closingIssues are cs in GitHub's order, less any GitHub gave as null,
// which decodes with no number or no repository.
func closingIssues(cs []fetch.ClosingIssue) []record.Issue {
	var out []record.Issue
	for _, c := range cs {
		if c.Number == 0 || c.Repository == "" {
			continue
		}
		is := record.Issue{Number: c.Number, Repository: c.Repository}
		if len(c.Labels) > 0 {
			is.Labels = labels(c.Labels)
		}
		out = append(out, is)
	}
	return out
}

func labels(ls []fetch.Label) []string {
	out := make([]string, len(ls))
	for i, l := range ls {
		out[i] = l.Name
	}
	slices.Sort(out)
	return out
}

func commits(cs []fetch.Commit) record.Commits {
	out := record.Commits{Count: len(cs), List: make([]record.Commit, len(cs))}
	for i, c := range cs {
		authored, committed := utc(c.AuthoredDate), utc(c.CommittedDate)
		out.List[i] = record.Commit{SHA: c.OID, Authored: authored, Committed: committed}
		if out.FirstAuthored == nil || authored.Before(*out.FirstAuthored) {
			out.FirstAuthored = &authored
		}
		if out.LastCommitted == nil || committed.After(*out.LastCommitted) {
			out.LastCommitted = &committed
		}
	}
	return out
}

func lifecycle(items []fetch.Event) ([]record.Event, error) {
	out := make([]record.Event, 0, len(items))
	for _, it := range items {
		kind, ok := eventKinds[it.Typename]
		if !ok {
			return nil, fmt.Errorf("unknown event %q", it.Typename)
		}
		id, _ := eventID(it.URL)
		out = append(out, record.Event{At: utc(it.CreatedAt), Kind: kind, ID: id, SHA: eventSHA(it)})
	}
	slices.SortStableFunc(out, func(a, b record.Event) int { return a.At.Compare(b.At) })
	return out, nil
}

// reviews keeps the submitted reviews; a pending one has no submission
// time.
func reviews(rs []fetch.Review) []record.Review {
	out := make([]record.Review, 0, len(rs))
	for _, r := range rs {
		if r.SubmittedAt == nil {
			continue
		}
		a := actor(r.Author)
		out = append(out, record.Review{At: utc(*r.SubmittedAt), ID: r.DatabaseID, By: a.Login, Bot: a.Bot, State: strings.ToLower(r.State)})
	}
	slices.SortStableFunc(out, func(a, b record.Review) int { return a.At.Compare(b.At) })
	return out
}

func comments(cs []fetch.Comment) []record.Comment {
	out := make([]record.Comment, len(cs))
	for i, c := range cs {
		a := actor(c.Author)
		out[i] = record.Comment{At: utc(c.CreatedAt), ID: c.DatabaseID, By: a.Login, Bot: a.Bot, Text: commentText(c.Body)}
	}
	slices.SortStableFunc(out, func(a, b record.Comment) int { return a.At.Compare(b.At) })
	return out
}

// commentText is the comment's text when it is short enough to be a bot
// command, and empty otherwise. A text with an `@` is not kept: a mention
// or an e-mail address names a person, and a bot command has neither,
// unless it is addressed to one of commandBots.
func commentText(body string) string {
	t := strings.TrimSpace(body)
	if strings.ContainsAny(t, "\r\n") || utf8.RuneCountInString(t) > maxCommentText {
		return ""
	}
	if strings.Contains(withoutCommandBot(t), "@") {
		return ""
	}
	return t
}

// withoutCommandBot is t without its leading mention of one of
// commandBots, or t itself when it does not start with one followed by
// whitespace.
func withoutCommandBot(t string) string {
	i := strings.IndexFunc(t, unicode.IsSpace)
	if i < 0 || !strings.HasPrefix(t, "@") {
		return t
	}
	handle := t[1:i]
	if !slices.ContainsFunc(commandBots, func(b string) bool { return strings.EqualFold(handle, b) }) {
		return t
	}
	return t[i:]
}

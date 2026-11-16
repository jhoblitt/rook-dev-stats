// Package classify applies the hand-edited tables to the committed records:
// who is human, what each comment is, how a pull request discloses LLM use
// and with which tools, its components and its kind. Every verdict is a
// pure function of the records, the tables and data/tickets.json.
package classify

import (
	"slices"
	"strings"

	"github.com/jhoblitt/rook-dev-stats/internal/fetch"
	"github.com/jhoblitt/rook-dev-stats/internal/record"
	"github.com/jhoblitt/rook-dev-stats/internal/tables"
	"github.com/jhoblitt/rook-dev-stats/internal/tracker"
)

// Comment kinds, named as the site's event kinds.
const (
	BotAccount    = "bot_account"
	CommandAuthor = "command_author"
	CommandOther  = "command_other"
	CommentAuthor = "comment_author"
	CommentOther  = "comment_other"
)

// Disclosure classes, named as the site names them.
const (
	DisclosureNone        = "none"
	DisclosureDescription = "description"
	DisclosureCoauthor    = "coauthor"
	DisclosureTrailer     = "trailer"
)

// DisclosureClasses returns the disclosure classes from lowest to highest.
func DisclosureClasses() []string {
	return []string{DisclosureNone, DisclosureDescription, DisclosureCoauthor, DisclosureTrailer}
}

// The record lists a disclosure candidate comes from.
const (
	FromTrailers    = "trailers"
	FromDescription = "description"
	FromCommitProse = "commit_prose"
)

// SourceOriginal is the kind source of a backport that takes the kind of
// the pull request it backports. The other sources are tables.Source*.
const SourceOriginal = "original"

// coauthorKey is the trailer key that discloses as a co-author without
// being listed in tools.yaml.
const coauthorKey = "co-authored-by"

// unspecifiedFamily is the tools.yaml family of a disclosure that names no
// tool, such as a bare "AI" or "LLM".
const unspecifiedFamily = "unspecified"

// PR is one pull request's classification.
type PR struct {
	Number int
	// AuthorHuman is whether the author is human.
	AuthorHuman bool
	// Comments are the record's comments' verdicts, index for index.
	Comments []Comment
	// Reviews are the record's reviews' verdicts, index for index.
	Reviews []Review
	// Disclosure is one of the Disclosure classes.
	Disclosure string
	// Candidates are the verdicts on the record's disclosure candidates:
	// trailers, then description, then commit prose, each in record order.
	Candidates []Candidate
	// Families are the ids of the families the counted disclosures name,
	// in table order, leaving out unspecified when another is named.
	Families []string
	// Components are the ids of the components the labels name, in table
	// order.
	Components []string
	// Kind is a kind id, or "" when unknown.
	Kind string
	// KindSource is tables.SourceChecklist, SourceTracker or SourceLabels,
	// SourceOriginal, or "" when the kind is unknown.
	KindSource string
}

// Comment is a comment's verdict.
type Comment struct {
	// Kind is one of the comment kinds.
	Kind string
	// Command is the command's id for CommandAuthor and CommandOther, else
	// "".
	Command string
}

// Review is a review's verdict.
type Review struct {
	// Human is whether the reviewer is human.
	Human bool
	// Other is whether the reviewer is a human other than the author.
	Other bool
}

// Candidate is the verdict on one disclosure candidate.
type Candidate struct {
	Text string
	// From is the record list it came from: one of the From constants.
	From string
	// Class is the disclosure class it gives, or "" when it does not count.
	Class string
	// Family is the family it names when it counts, or "" for none.
	Family string
	// Ignored is whether tools.yaml's ignore list names it.
	Ignored bool
}

// Records classifies every record, the result index for index with recs.
// A backport's kind needs the kind of the pull request it names, so the
// whole set is classified at once.
func Records(t *tables.Tables, tickets map[int]tracker.Ticket, recs []record.Record) []PR {
	prs := make([]PR, len(recs))
	for i := range recs {
		prs[i] = classify(t, &recs[i])
		prs[i].Kind, prs[i].KindSource = ownKind(t, tickets, &recs[i])
	}
	resolveOriginals(recs, prs)
	return prs
}

func classify(t *tables.Tables, r *record.Record) PR {
	p := PR{
		Number:      r.Number,
		AuthorHuman: human(t, r.Author.Login, r.Author.Bot),
		Comments:    make([]Comment, len(r.Comments)),
		Reviews:     make([]Review, len(r.Reviews)),
		Components:  t.Labels.ComponentsOf(r.Labels),
	}
	for i, c := range r.Comments {
		p.Comments[i] = comment(t, r, c)
	}
	for i, rv := range r.Reviews {
		h := human(t, rv.By, rv.Bot)
		p.Reviews[i] = Review{Human: h, Other: h && !byAuthor(r, rv.By)}
	}
	p.Candidates, p.Disclosure, p.Families = disclosure(t, r.Disclosure)
	return p
}

// human is the design's definition: not typed a bot by GitHub and not
// listed in bots.yaml.
func human(t *tables.Tables, login string, bot bool) bool {
	return !bot && !t.Bots.Listed(login)
}

// byAuthor is whether login is the pull request's author. Every deleted
// account is recorded as the one ghost login, so two ghosts are not known
// to be the same person.
func byAuthor(r *record.Record, login string) bool {
	return login == r.Author.Login && login != fetch.GhostLogin
}

func comment(t *tables.Tables, r *record.Record, c record.Comment) Comment {
	if !human(t, c.By, c.Bot) {
		return Comment{Kind: BotAccount}
	}
	author := byAuthor(r, c.By)
	if id := t.Commands.Match(c.Text); id != "" {
		if author {
			return Comment{Kind: CommandAuthor, Command: id}
		}
		return Comment{Kind: CommandOther, Command: id}
	}
	if author {
		return Comment{Kind: CommentAuthor}
	}
	return Comment{Kind: CommentOther}
}

func disclosure(t *tables.Tables, d record.Disclosure) (cands []Candidate, class string, families []string) {
	class = DisclosureNone
	named := map[string]bool{}
	add := func(text, from, counts string) {
		c := Candidate{Text: text, From: from}
		switch {
		case t.Tools.Ignored(text):
			c.Ignored = true
		case counts != "":
			c.Class = counts
			if c.Family = t.Tools.Family(text); c.Family != "" {
				named[c.Family] = true
			}
			if rank(counts) > rank(class) {
				class = counts
			}
		}
		cands = append(cands, c)
	}
	for _, line := range d.Trailers {
		add(line, FromTrailers, trailerClass(t, line))
	}
	for _, list := range []struct {
		from  string
		lines []string
	}{{FromDescription, d.Description}, {FromCommitProse, d.CommitProse}} {
		for _, line := range list.lines {
			counts := ""
			if t.Tools.Phrase(line) {
				counts = DisclosureDescription
			}
			add(line, list.from, counts)
		}
	}
	// The site counts a pull request under every family it lists, so a
	// bare "AI" beside a named tool would count it as unspecified too.
	if len(named) > 1 {
		delete(named, unspecifiedFamily)
	}
	for _, f := range t.Tools.Families {
		if named[f.ID] {
			families = append(families, f.ID)
		}
	}
	return cands, class, families
}

// trailerClass is the class a trailer candidate gives by its key, or ""
// when its key gives none.
func trailerClass(t *tables.Tables, line string) string {
	key, _, _ := strings.Cut(line, ":")
	key = strings.TrimSpace(key)
	switch {
	case t.Tools.TrailerKey(key):
		return DisclosureTrailer
	case strings.EqualFold(key, coauthorKey):
		return DisclosureCoauthor
	}
	return ""
}

func rank(class string) int {
	return slices.Index(DisclosureClasses(), class)
}

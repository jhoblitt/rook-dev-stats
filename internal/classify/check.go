package classify

import (
	"cmp"
	"errors"
	"fmt"
	"io"
	"maps"
	"slices"
	"strconv"
	"strings"

	"github.com/jhoblitt/rook-dev-stats/internal/fetch"
	"github.com/jhoblitt/rook-dev-stats/internal/record"
	"github.com/jhoblitt/rook-dev-stats/internal/tables"
)

const (
	// minLabelPRs is how many pull requests a label must be on before it
	// must be classified.
	minLabelPRs = 5
	// maxNamed is how many pull requests a problem names.
	maxNamed = 5
)

// CheckInput is what Check validates the tables against.
type CheckInput struct {
	Tables  *tables.Tables
	Records []record.Record
	// Meta is nil when there is no meta.json.
	Meta *record.Meta
	// Top is how many entries each ranked report lists; 0 lists all. The
	// problem and base-branch reports list every entry.
	Top int
}

// Check classifies the records and writes reports for whoever tunes the
// tables to out: GitHub's counts against the records', how many pull
// requests deleted accounts opened and how many of those their commits
// name, the candidates behind the problems below, the
// neighboring candidates that match a phrase only when joined, the
// description and commit-prose candidates that match no phrase, the short
// comments by people that match no command, the accounts not typed bots
// with the most comments, and the base branches, each most frequent first.
// Its error lists every problem the tables leave in the data:
//   - no family in tools.yaml with the id unspecified, which the rule that
//     drops it beside a named tool depends on;
//   - a trailer candidate whose key is neither a trailer key nor
//     Co-authored-by, and that ignore does not list;
//   - a counted disclosure that matches no family;
//   - a label on 5 or more pull requests that no table classifies;
//   - record counts more than 0.5% from GitHub's counts in meta.json.
//
// A candidate line can name a person, and the error is printed where out is
// not, so the error names a candidate's problem by its trailer key and pull
// requests and only out quotes the line.
func Check(in CheckInput, out io.Writer) error {
	t := in.Tables
	prs := Records(t, in.Records)

	var errs []error
	if !slices.ContainsFunc(t.Tools.Families, func(f tables.Family) bool { return f.ID == unspecifiedFamily }) {
		errs = append(errs, fmt.Errorf("%s: no family has the id %q, which a disclosure that names no tool is counted under",
			tables.ToolsFile, unspecifiedFamily))
	}
	unknownKey, noFamily := problems{}, problems{}
	unmatched := map[string]int{}
	for i := range prs {
		p := &prs[i]
		// A line can be in more than one of a record's lists; trailers come
		// first, so a trailer's problem is the one reported.
		seen := map[string]bool{}
		for _, c := range p.Candidates {
			if c.Ignored || seen[c.Text] {
				continue
			}
			seen[c.Text] = true
			switch {
			case c.Class != "" && c.Family == "":
				noFamily.add(c, p.Number)
			case c.Class == "" && c.From == FromTrailers:
				unknownKey.add(c, p.Number)
			case c.Class == "":
				unmatched[c.Text]++
			}
		}
	}
	for _, key := range slices.Sorted(maps.Keys(unknownKey)) {
		errs = append(errs, fmt.Errorf("%s: trailer key %q is not in trailer_keys or Co-authored-by, and no ignore entry lists a line with it (%s)",
			tables.ToolsFile, key, unknownKey[key].summary()))
	}
	for _, key := range slices.Sorted(maps.Keys(noFamily)) {
		what := "a counted description or commit-prose disclosure"
		if key != "" {
			what = fmt.Sprintf("a counted disclosure with the trailer key %q", key)
		}
		errs = append(errs, fmt.Errorf("%s: no family matches %s (%s)", tables.ToolsFile, what, noFamily[key].summary()))
	}
	errs = append(errs, labelProblems(t, in.Records)...)
	counts, countErrs := compareCounts(in.Records, in.Meta)
	errs = append(errs, countErrs...)

	fmt.Fprintln(out, counts)
	fmt.Fprintln(out, deletedAuthors(in.Records))
	report(out, "Trailers with an unlisted key and no ignore entry", unknownKey.lines(), 0)
	report(out, "Counted disclosures that match no family", noFamily.lines(), 0)
	joined := map[string][]int{}
	for i := range prs {
		for _, text := range joinedOnly(t, &prs[i]) {
			joined[text] = append(joined[text], prs[i].Number)
		}
	}
	hint(out, joined, in.Top)
	report(out, "Description and commit-prose candidates that match no phrase", unmatched, in.Top)
	comments, accounts, bases := map[string]int{}, map[string]int{}, map[string]int{}
	for i := range in.Records {
		r := &in.Records[i]
		bases[r.Base]++
		for j, c := range r.Comments {
			if k := prs[i].Comments[j].Kind; c.Text != "" && (k == CommentAuthor || k == CommentOther) {
				comments[strings.ToLower(c.Text)]++
			}
			if !c.Bot {
				login := c.By
				if t.Bots.Listed(login) {
					login += " (" + tables.BotsFile + ")"
				}
				accounts[login]++
			}
		}
	}
	report(out, "Short comments by people that match no command", comments, in.Top)
	report(out, "Accounts with the most comments, not typed bots by GitHub", accounts, in.Top)
	report(out, "Base branches", bases, 0)
	return errors.Join(errs...)
}

// joinedOnly are the texts, each once, of p's neighboring description or
// commit-prose candidates, joined by a space, that match a phrase when
// neither line counts alone or is ignored: perhaps a disclosure wrapped
// across a line break. They never count. A record's candidate lists hold
// only possible disclosures, de-duplicated, and commit prose runs on across
// commits, so neighboring candidates are often not neighboring lines.
func joinedOnly(t *tables.Tables, p *PR) []string {
	var out []string
	seen := map[string]bool{}
	for i := 1; i < len(p.Candidates); i++ {
		a, b := p.Candidates[i-1], p.Candidates[i]
		if a.From != b.From || a.From == FromTrailers || a.Class != "" || b.Class != "" || a.Ignored || b.Ignored {
			continue
		}
		if text := a.Text + " " + b.Text; !seen[text] && t.Tools.Phrase(text) {
			seen[text] = true
			out = append(out, text)
		}
	}
	return out
}

// hint writes the joined texts, the pull requests on most first, then by
// text, at most top of them when top is above zero.
func hint(out io.Writer, joined map[string][]int, top int) {
	keys := slices.SortedFunc(maps.Keys(joined), func(a, b string) int {
		return cmp.Or(cmp.Compare(len(joined[b]), len(joined[a])), cmp.Compare(a, b))
	})
	fmt.Fprintf(out, "Neighboring candidates that match a phrase only when joined: %d\n", len(keys))
	if len(keys) > 0 {
		fmt.Fprintf(out, "    For a real disclosure, add a phrase to %s that one of its lines matches alone.\n", tables.ToolsFile)
	}
	for i, k := range keys {
		if top > 0 && i == top {
			fmt.Fprintf(out, "    and %d more\n", len(keys)-top)
			break
		}
		fmt.Fprintf(out, "    %s (%s)\n", k, prList(joined[k]))
	}
}

// problems are the candidate lines with one kind of problem, grouped by the
// lower-cased trailer key they share, or "" for lines that are not
// trailers.
type problems map[string]problem

// problem is the pull requests each line is on.
type problem map[string][]int

func (ps problems) add(c Candidate, number int) {
	key := ""
	if c.From == FromTrailers {
		k, _, _ := strings.Cut(c.Text, ":")
		key = strings.ToLower(strings.TrimSpace(k))
	}
	if ps[key] == nil {
		ps[key] = problem{}
	}
	ps[key][c.Text] = append(ps[key][c.Text], number)
}

// lines are how many pull requests each line is on.
func (ps problems) lines() map[string]int {
	out := map[string]int{}
	for _, p := range ps {
		for line, numbers := range p {
			out[line] += len(numbers)
		}
	}
	return out
}

// summary counts the lines and names their pull requests without quoting a
// line.
func (p problem) summary() string {
	numbers := map[int]bool{}
	for _, ns := range p {
		for _, n := range ns {
			numbers[n] = true
		}
	}
	lines := "1 line"
	if len(p) != 1 {
		lines = strconv.Itoa(len(p)) + " lines"
	}
	return lines + ", " + prList(slices.Collect(maps.Keys(numbers)))
}

func labelProblems(t *tables.Tables, recs []record.Record) []error {
	on := map[string]int{}
	for i := range recs {
		for _, l := range recs[i].Labels {
			on[l]++
		}
	}
	var errs []error
	for _, l := range slices.Sorted(maps.Keys(on)) {
		if _, kind := t.Kinds.Labels[l]; on[l] >= minLabelPRs && !kind && !t.Labels.Classified(l) {
			errs = append(errs, fmt.Errorf("%s: label %q is on %d pull requests and no table classifies it", tables.LabelsFile, l, on[l]))
		}
	}
	return errs
}

// compareCounts allows the records and GitHub's counts to differ by 0.5%,
// for pull requests opened or closed while the walk ran.
func compareCounts(recs []record.Record, meta *record.Meta) (string, []error) {
	if meta == nil {
		return "Counts: no " + record.MetaFile + " to compare with", nil
	}
	start := meta.WindowStart
	if start.IsZero() {
		start = fetch.WindowStart
	}
	opened, open := 0, 0
	for i := range recs {
		if !recs[i].Created.Before(start) {
			opened++
		}
		if recs[i].State == record.StateOpen {
			open++
		}
	}
	gh := meta.GitHubCounts
	source := gh.OpenedInWindowSource.OrSearch()
	var errs []error
	if apart(opened, gh.OpenedInWindow) {
		err := fmt.Errorf("%s: the records hold %d pull requests opened in the window, GitHub's %s counted %d: more than 0.5%% apart",
			record.MetaFile, opened, source, gh.OpenedInWindow)
		if source == record.SourceSearch {
			err = fmt.Errorf("%w; GitHub's search has been seen to omit pull requests that its listing returns", err)
		}
		errs = append(errs, err)
	}
	if apart(open, gh.Open) {
		errs = append(errs, fmt.Errorf("%s: the records hold %d open pull requests, GitHub's %s counted %d: more than 0.5%% apart",
			record.MetaFile, open, record.SourceListing, gh.Open))
	}
	line := fmt.Sprintf("Counts: %d opened in the window (GitHub's %s: %d), %d open (GitHub's %s: %d)",
		opened, source, gh.OpenedInWindow, open, record.SourceListing, gh.Open)
	return line, errs
}

// deletedAuthors counts the pull requests opened by deleted accounts, those
// of them named from their commits, and the distinct names, without naming
// anyone.
func deletedAuthors(recs []record.Record) string {
	opened, named := 0, 0
	names := map[string]bool{}
	for i := range recs {
		a := recs[i].Author
		if a.Login != fetch.GhostLogin {
			continue
		}
		opened++
		if a.Name != "" {
			named++
			names[a.Name] = true
		}
	}
	return fmt.Sprintf("Pull requests by deleted accounts: %d, named from their commits: %d, distinct names: %d", opened, named, len(names))
}

func apart(got, github int) bool {
	d := got - github
	if d < 0 {
		d = -d
	}
	return 1000*d > 5*github
}

// report writes counts most frequent first, then by text, at most top of
// them when top is above zero.
func report(out io.Writer, title string, counts map[string]int, top int) {
	keys := slices.SortedFunc(maps.Keys(counts), func(a, b string) int {
		return cmp.Or(cmp.Compare(counts[b], counts[a]), cmp.Compare(a, b))
	})
	fmt.Fprintf(out, "%s: %d\n", title, len(keys))
	for i, k := range keys {
		if top > 0 && i == top {
			fmt.Fprintf(out, "    and %d more\n", len(keys)-top)
			break
		}
		fmt.Fprintf(out, "%7d  %s\n", counts[k], k)
	}
}

// prList names the first few of the pull requests, in order.
func prList(numbers []int) string {
	numbers = slices.Sorted(slices.Values(numbers))
	var b strings.Builder
	for i, n := range numbers {
		if i == maxNamed {
			fmt.Fprintf(&b, " and %d more", len(numbers)-maxNamed)
			break
		}
		if i > 0 {
			b.WriteString(", ")
		}
		b.WriteString("#" + strconv.Itoa(n))
	}
	return b.String()
}

package extract

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/jhoblitt/rook-dev-stats/internal/record"
)

// The whole disclosure-candidate rule lives in this file. It finds
// candidates, never verdicts: the hand-edited tools table decides later,
// so the broad list errs towards keeping a line. A plain extract run
// re-derives every record its current-format cache entry is as new as, so
// a tuned rule reaches the records on the next run.

// broad is the broad word list. Everything is case-insensitive except "AI",
// which is matched only as an upper-case word. "cursor" is a RADOS term, so
// Cursor is matched only by its agent address here, and as the value of a
// -by trailer below. "claude" stays unbounded, since values such as
// "IBM-Bob:ClaudeSonnet" run it into the next word; the words bounded here
// otherwise match inside "raider", "philanthropic" and "regenerated
// without".
var broad = regexp.MustCompile(`(?i:` +
	`claude|\banthropic\b|copilot|gemini|codex|chatgpt|openai|` +
	`\bgpt(?:\b|\d)|\bllms?\b|` +
	`\baider\b|windsurf|ibm[ -]bob|` +
	`assisted[ -]by|assistant[ -]by|\bgenerated[ -](?:with|by)\b|raised[ -]by|` +
	`cursoragent|cursor\.com` +
	`)|\bAI\b`)

// byValue is what else the value of a -by trailer may name.
var byValue = regexp.MustCompile(`(?i)\bcursor\b`)

// toolAddresses are the addresses, lower-cased, that tools sign a line
// with: every address the committed candidates held when the list was made,
// and none of a person. An address not here is a person's until a
// maintainer, prompted by extract's log, adds it. A token is compared with
// them whole: nothing in this file looks for one inside a longer string.
var toolAddresses = map[string]bool{
	"noreply@anthropic.com":  true, // Claude Code
	"norpley@anthropic.com":  true, // Claude Code's, misspelled in one commit
	"cursoragent@cursor.com": true, // Cursor's agent
	"bob@ibm.com":            true, // IBM Bob
}

// copilotAddress is GitHub's no-reply address of its Copilot login,
// <account id>+copilot@…, which the data holds under more than one id. It
// is anchored at both ends, so it matches a whole token or nothing.
var copilotAddress = regexp.MustCompile(`^\d+\+copilot@users\.noreply\.github\.com$`)

// splitRunes are the runes a normalized line is cut into tokens at: ASCII
// space and tab, brackets, quotes and separators. No other rune cuts, so a
// non-breaking space stays inside its token.
const splitRunes = " \t<>()[]\",;:"

// mentionOpeners may stand between the start of a line, a space or a tab
// and the @ of a mention, as in (@claude), "@claude" or *@claude*. > is not
// one, so GitHub's defused <code>@login</code> is not a mention.
const mentionOpeners = "([\"'*_`"

// trailingPunctuation is trimmed from the end of an address token before it
// is compared with the tools' addresses.
const trailingPunctuation = ".!?"

// wrappingPairs are the marks trimmed from an address token only as a
// matched pair around the whole of it: an unmatched one may be part of an
// address, as in ~bob@ibm.com.
var wrappingPairs = [][2]byte{{'*', '*'}, {'_', '_'}, {'`', '`'}, {'\'', '\''}, {'{', '}'}, {'|', '|'}, {'~', '~'}}

// coAuthoredBy is the Co-authored-by key in a normalized line: "co", a run
// of hyphens, underscores or spaces that may be empty, "authored", a run of
// at least one, and "by". keys checks that neither end of a match touches
// a letter or digit, which \b cannot do here since it takes _ for a word
// character.
var coAuthoredBy = regexp.MustCompile(`co[-_ \t]*authored[-_ \t]+by`)

// closingTags are the HTML closing tags that may follow a tool's address on
// a Co-authored-by line that is kept.
var closingTags = regexp.MustCompile(`</(?:li|p|td|th|a|em|strong|code|span|b|i|div)>`)

// separator, between a Co-authored-by key and its address, means the line
// names someone besides the tool.
var separator = regexp.MustCompile(`[,;&/+|]|(?:^|[^\p{L}\p{N}])(?:and|with)(?:$|[^\p{L}\p{N}])`)

// letterOrDigit after a tool's address means the line names someone after it.
var letterOrDigit = regexp.MustCompile(`[\p{L}\p{N}]`)

// plainDomain is a domain fit for the log: lower-case letters, digits, dots
// and hyphens, at most 253 of them.
var plainDomain = regexp.MustCompile(`^[a-z0-9.-]{1,253}$`)

// The log keys for a withheld line that do not name a domain.
const (
	keyOther     = "other"
	keyNoAddress = "no address"
)

// trailerLine is a `Key: value` line, the key one token of letters, digits
// and hyphens. A trailer anywhere in a message counts: a backport appends
// "(cherry picked from commit …)" and a Conflicts paragraph after the
// original trailers.
var trailerLine = regexp.MustCompile(`^([A-Za-z][A-Za-z0-9-]*):(?:\s+(.*))?$`)

// neverKept are trailer keys, lower-cased, whose lines are never a
// candidate, whatever they say: they name people, addresses or links.
var neverKept = map[string]bool{
	"signed-off-by": true, "reviewed-by": true, "tested-by": true,
	"acked-by": true, "reported-by": true, "suggested-by": true,
	"cc": true, "fixes": true, "resolves": true, "see-also": true,
	"backport": true, "change-id": true, "conflicts": true,
	"link": true, "url": true,
}

// checklistLine is a Markdown checklist line, its bullet optional: the
// box's mark, empty or an x in any case, and its label.
var checklistLine = regexp.MustCompile(`^(?:[-*+]\s*)?\[\s*([xX]?)\s*\]\s*(.*)$`)

// templateLabel is, lower-cased, a label that says no more than the
// AI-guidelines box of rook/rook's pull request template, with or without
// its link and its condition. Plain words may name other guides beside
// the AI guidelines, as in "reviewed developer guide and ai guidelines".
var templateLabel = regexp.MustCompile(`^reviewed (?:[a-z ]+ )?(?:\[ai guidelines\]\([^)]*\)|ai guidelines)(?:,? if ai assisted with the pr)?\.?$`)

// mergifyBreak is where Mergify joins its sentence to the description of
// the pull request it backports.
const mergifyBreak = "<hr>"

// maxCandidate is the most characters of a line a candidate keeps.
const maxCandidate = 200

// Candidates finds the lines of a pull request's commit messages and
// description that might disclose LLM use:
//   - trailers: a commit trailer whose key matches the broad list, or whose
//     key ends in -by and whose value does;
//   - commit_prose: any other commit-message line that matches;
//   - description: any description line that matches.
//
// A description line that is the AI-guidelines box sets Checklist when it
// is ticked, and is a candidate only when it says more than the template
// does.
//
// A line with a never-kept key is dropped from all three, and so is a line
// withhold refuses, which is counted in withheld under the key withhold
// gives; withheld is nil when there are none. Each candidate is kept as
// written, trimmed and cut at 200 characters, and each list is
// de-duplicated in order of first appearance.
func Candidates(messages []string, description string) (d record.Disclosure, withheld map[string]int) {
	trailers, prose, desc := newList(), newList(), newList()
	keep := func(l *list, line string) {
		key, ok := withhold(line)
		if !ok {
			l.add(line)
			return
		}
		if withheld == nil {
			withheld = map[string]int{}
		}
		withheld[key]++
	}
	for _, m := range messages {
		for line := range strings.Lines(m) {
			line = strings.TrimSpace(line)
			key, value, isTrailer := splitTrailer(line)
			switch {
			case isTrailer && neverKept[key]:
			case isTrailer && keepTrailer(key, value):
				keep(trailers, line)
			case broad.MatchString(line):
				keep(prose, line)
			}
		}
	}
	checklist := false
	for line := range strings.Lines(description) {
		line = strings.TrimSpace(line)
		if isBox, ticked, more := aiBox(line); isBox {
			checklist = checklist || ticked
			if !more {
				continue
			}
		}
		key, _, isTrailer := splitTrailer(line)
		if isTrailer && neverKept[key] {
			continue
		}
		if broad.MatchString(line) {
			keep(desc, line)
		}
	}
	return record.Disclosure{Trailers: trailers.lines, Description: desc.lines, CommitProse: prose.lines, Checklist: checklist}, withheld
}

// aiBox reports whether line is the AI-guidelines box: a checklist line
// whose label, lower-cased, starts with "reviewed" and holds "ai
// guidelines". It reports too whether the box is ticked, and whether the
// label says more than templateLabel before any mergifyBreak.
func aiBox(line string) (isBox, ticked, more bool) {
	m := checklistLine.FindStringSubmatch(line)
	if m == nil {
		return false, false, false
	}
	label := strings.ToLower(m[2])
	if !strings.HasPrefix(label, "reviewed") || !strings.Contains(label, "ai guidelines") {
		return false, false, false
	}
	own, _, _ := strings.Cut(label, mergifyBreak)
	return true, m[1] != "", !templateLabel.MatchString(strings.TrimSpace(own))
}

// withhold reports whether a candidate line must not be kept, since it may
// name a person, and the key it is counted under. It reads the line through
// normalize and cuts it into tokens. A line is withheld when it holds an
// address token that is not a tool's, counted under that token's domain.
// A line holding the Co-authored-by key names an identity, so it is
// withheld too unless the key occurs once, the line holds exactly one
// address token, a tool's, the key comes before it with no separator
// between them, and no letter or digit follows it outside closingTags; it is
// counted as "no address" when it holds no address token, and under the
// last address token's domain otherwise.
func withhold(line string) (key string, ok bool) {
	n := normalize(line)
	addrs := addressTokens(n)
	for _, a := range addrs {
		if !isToolAddress(a.text) {
			return domainKey(a.text), true
		}
	}
	ks := keys(n)
	if len(ks) == 0 {
		return "", false
	}
	if len(addrs) == 0 {
		return keyNoAddress, true
	}
	a := addrs[len(addrs)-1]
	if len(ks) > 1 || len(addrs) > 1 || ks[0][1] > a.start ||
		separator.MatchString(n[ks[0][1]:a.start]) ||
		letterOrDigit.MatchString(closingTags.ReplaceAllLiteralString(n[a.end:], "")) {
		return domainKey(a.text), true
	}
	return "", false
}

// normalize is line as withhold tests it: without the zero-width
// characters and soft hyphens that hide a word from a pattern, with every
// hyphen or dash read as -, the full-width colon as :, the full-width and
// small @ as @, and in lower case.
func normalize(line string) string {
	return strings.ToLower(strings.Map(func(r rune) rune {
		switch {
		case r == '\u200b' || r == '\u200c' || r == '\u200d' || r == '\u2060' || r == '\ufeff' || r == '\u00ad':
			return -1
		case unicode.Is(unicode.Pd, r) || r == '\u2212':
			return '-'
		case r == '\uff1a' || r == '\ufe55':
			return ':'
		case r == '\uff20' || r == '\ufe6b':
			return '@'
		}
		return r
	}, line))
}

// token is a run of a normalized line between splitRunes, and where it is.
type token struct {
	text       string
	start, end int
}

// addressTokens returns the tokens of s that hold %40, or an @ that does not
// start a mention.
func addressTokens(s string) []token {
	var out []token
	start := -1
	for i := 0; i <= len(s); i++ {
		if i < len(s) && !strings.ContainsRune(splitRunes, rune(s[i])) {
			if start < 0 {
				start = i
			}
			continue
		}
		if start >= 0 {
			if isAddressToken(s, start, i) {
				out = append(out, token{text: s[start:i], start: start, end: i})
			}
			start = -1
		}
	}
	return out
}

// isAddressToken reports whether the token s[start:end] holds %40, or an @
// that does not start a mention. An @ starts a mention only when it is its
// token's one @, its token holds no %40, a letter or digit follows it, and
// before it, past any mentionOpeners, comes the start of the line, a space
// or a tab. So a lone @ or one straight after text is never a mention.
func isAddressToken(s string, start, end int) bool {
	t := s[start:end]
	if strings.Contains(t, "%40") {
		return true
	}
	if strings.Count(t, "@") != 1 {
		return strings.Contains(t, "@")
	}
	at := start + strings.Index(t, "@")
	after, _ := utf8.DecodeRuneInString(s[at+1:])
	if at+1 == len(s) || !isLetterOrDigit(after) {
		return true
	}
	i := at
	for i > 0 && strings.IndexByte(mentionOpeners, s[i-1]) >= 0 {
		i--
	}
	return i > 0 && s[i-1] != ' ' && s[i-1] != '\t'
}

// trimAddress is an address token without the marks that cannot be part of
// an address: any trailingPunctuation at its end, and any wrappingPairs
// around the whole of it, repeatedly.
func trimAddress(t string) string {
	for {
		t = strings.TrimRight(t, trailingPunctuation)
		unwrapped := false
		for _, p := range wrappingPairs {
			if len(t) >= 2 && t[0] == p[0] && t[len(t)-1] == p[1] {
				t, unwrapped = t[1:len(t)-1], true
				break
			}
		}
		if !unwrapped {
			return t
		}
	}
}

// isToolAddress reports whether an address token, through trimAddress, is
// exactly a tool's address.
func isToolAddress(t string) bool {
	t = trimAddress(t)
	return toolAddresses[t] || copilotAddress.MatchString(t)
}

// keys returns where the Co-authored-by key occurs in s with neither end
// touching a letter or digit.
func keys(s string) [][]int {
	var out [][]int
	for _, m := range coAuthoredBy.FindAllStringIndex(s, -1) {
		before, _ := utf8.DecodeLastRuneInString(s[:m[0]])
		after, _ := utf8.DecodeRuneInString(s[m[1]:])
		if m[0] > 0 && isLetterOrDigit(before) || m[1] < len(s) && isLetterOrDigit(after) {
			continue
		}
		out = append(out, m)
	}
	return out
}

func isLetterOrDigit(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsDigit(r)
}

// domainKey is the log key of an address token: what follows its first @
// or %40, once through trimAddress, when that is a plain domain, and
// "other" otherwise. A plain domain is any run of letters, digits, dots and
// hyphens someone wrote after an @, so the key may be a login or a fragment
// of a name; it goes to the log of a local run and never into data/.
func domainKey(t string) string {
	t = trimAddress(t)
	i, n := strings.Index(t, "@"), 1
	if j := strings.Index(t, "%40"); j >= 0 && (i < 0 || j < i) {
		i, n = j, 3
	}
	if i < 0 {
		return keyOther
	}
	if domain := t[i+n:]; plainDomain.MatchString(domain) {
		return domain
	}
	return keyOther
}

// splitTrailer returns a trailer line's lower-cased key and its value.
func splitTrailer(line string) (key, value string, ok bool) {
	m := trailerLine.FindStringSubmatch(line)
	if m == nil {
		return "", "", false
	}
	return strings.ToLower(m[1]), m[2], true
}

func keepTrailer(key, value string) bool {
	if broad.MatchString(key) {
		return true
	}
	return strings.HasSuffix(key, "-by") && (broad.MatchString(value) || byValue.MatchString(value))
}

// list is a de-duplicated list of candidates, in order of first appearance.
type list struct {
	lines []string
	seen  map[string]bool
}

func newList() *list {
	return &list{lines: []string{}, seen: map[string]bool{}}
}

func (l *list) add(line string) {
	line = cut(line, maxCandidate)
	if !l.seen[line] {
		l.seen[line] = true
		l.lines = append(l.lines, line)
	}
}

// cut keeps the first n characters of s.
func cut(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}

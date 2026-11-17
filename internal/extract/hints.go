package extract

import (
	"regexp"
	"strconv"

	"github.com/jhoblitt/rook-dev-stats/internal/fetch"
	"github.com/jhoblitt/rook-dev-stats/internal/record"
)

// The whole kind-hint rule lives in this file. Like disclosure, it finds
// evidence, never a verdict: classify decides the kind from it later.

// The places a backport names its original. Only a pattern's first match
// counts, and only the first pull request that match names.
var (
	// mergifySentence is the sentence Mergify ends a backport's description
	// with: "automatic backport of pull request #N", or "automated" in its
	// older versions.
	mergifySentence = regexp.MustCompile(`(?i)\bautomat(?:ic|ed) backport of pull request #(\d+)\b`)
	// backportOf is "backport of" followed by the repository's pull-request
	// address, bare or as a Markdown link, or by #<number>.
	backportOf = regexp.MustCompile(`(?i)\bbackport of:?\s*(?:` +
		`(?:\[[^\]]*\]\()?(?:https?://)?github\.com/` +
		regexp.QuoteMeta(fetch.Owner+"/"+fetch.Name) + `/pull/(\d+)\b` +
		`|\[?#(\d+)\b)`)
	// titleSuffix is a title ending "(backport #N)", or "(bp #N)" as older
	// Mergify versions wrote it, and the hand-written variants without the
	// space or the #, with a hyphen, or with more after the number. A number
	// without # that a dot follows is a version, as in "(backport 1.5)".
	titleSuffix = regexp.MustCompile(`(?i)\((?:backport|bp)[\s-]*(?:#(\d+)\b[^()]*|(\d+)(?:[^.\d()][^()]*)?)\)\s*$`)
)

// Hints gathers what a pull request's kind can be decided from, or nil when
// there is nothing:
//   - issues, the issues GitHub links as closed by the pull request, kept
//     in GitHub's order;
//   - the pull request this one is a backport of: the first named, other
//     than number itself, by Mergify's sentence in the description, then
//     "backport of" in the description, then the title's suffix.
//
// The commit messages decide nothing yet.
func Hints(number int, title string, messages []string, description string, issues []record.Issue) *record.KindHints {
	h := record.KindHints{BackportOf: backport(number, title, description)}
	if len(issues) > 0 {
		h.Issues = issues
	}
	if h.Issues == nil && h.BackportOf == 0 {
		return nil
	}
	return &h
}

func backport(number int, title, description string) int {
	for _, c := range []struct {
		re   *regexp.Regexp
		text string
	}{
		{mergifySentence, description},
		{backportOf, description},
		{titleSuffix, title},
	} {
		if n := named(c.re, c.text); n != 0 && n != number {
			return n
		}
	}
	return 0
}

// named is the pull request re's first match in text names, or 0.
func named(re *regexp.Regexp, text string) int {
	m := re.FindStringSubmatch(text)
	if m == nil {
		return 0
	}
	for _, g := range m[1:] {
		if g != "" {
			n, err := strconv.Atoi(g)
			if err != nil {
				return 0
			}
			return n
		}
	}
	return 0
}

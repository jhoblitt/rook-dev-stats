package extract

import (
	"regexp"
	"strconv"

	"github.com/jhoblitt/rook-dev-stats/internal/record"
)

// The whole kind-hint rule lives in this file. Like disclosure, it finds
// evidence, never a verdict: classify decides the kind from it later.

// backportOf is "backport of" followed by a ceph/ceph pull-request address,
// bare or as a Markdown link, or by #<number>. Only the first pull request
// named counts.
var backportOf = regexp.MustCompile(`(?i)\bbackport of:?\s*(?:` +
	`(?:\[[^\]]*\]\()?(?:https?://)?github\.com/ceph/ceph/pull/(\d+)\b` +
	`|\[?#(\d+)\b)`)

// Hints gathers what a pull request's kind can be decided from, or nil when
// there is nothing:
//   - issues, the issues GitHub links as closed by the pull request, kept
//     in GitHub's order;
//   - the pull request the description's "backport of" names.
//
// The number, title and commit messages decide nothing yet.
func Hints(number int, title string, messages []string, description string, issues []record.Issue) *record.KindHints {
	h := record.KindHints{BackportOf: backport(description)}
	if len(issues) > 0 {
		h.Issues = issues
	}
	if h.Issues == nil && h.BackportOf == 0 {
		return nil
	}
	return &h
}

func backport(description string) int {
	m := backportOf.FindStringSubmatch(description)
	if m == nil {
		return 0
	}
	n, err := strconv.Atoi(m[1] + m[2])
	if err != nil {
		return 0
	}
	return n
}

package extract

import (
	"regexp"
	"strconv"
	"strings"

	"github.com/jhoblitt/ceph-dev-stats/internal/record"
)

// The whole kind-hint rule lives in this file. Like disclosure, it finds
// evidence, never a verdict: classify decides the kind from it later.

// tickedBox is a ticked checklist line, the box's label in group 1.
var tickedBox = regexp.MustCompile(`^\s*(?:[-*+]\s*)?\[[xX]\]\s*(.*)$`)

// boxes are the Tracker section's boxes, in the order Checklist lists them,
// each known by the start of its label in ceph/ceph's pull request template.
var boxes = []struct{ hint, label string }{
	{record.CheckReferencesTicket, "references tracker ticket"},
	{record.CheckVeryRecentBug, "very recent bug"},
	{record.CheckNewFeature, "new feature"},
	{record.CheckDocUpdate, "doc update"},
	{record.CheckCodeCleanup, "code cleanup"},
}

// ticketURL is a tracker.ceph.com issue address. The character before the
// host keeps a longer host such as mytracker.ceph.com from matching.
var ticketURL = regexp.MustCompile(`(?i)(?:^|[^\w.-])tracker\.ceph\.com/issues/(\d+)\b`)

// fixesTrailer is a commit message's Fixes: line, its value in group 1.
var fixesTrailer = regexp.MustCompile(`(?i)^fixes:(.*)$`)

// backportOf is "backport of" followed by a ceph/ceph pull-request address,
// bare or as a Markdown link, or by #<number>. Only the first pull request
// named counts.
var backportOf = regexp.MustCompile(`(?i)\bbackport of:?\s*(?:` +
	`(?:\[[^\]]*\]\()?(?:https?://)?github\.com/ceph/ceph/pull/(\d+)\b` +
	`|\[?#(\d+)\b)`)

// Hints finds what a pull request's kind can be decided from in its commit
// messages and description, or nil when there is nothing:
//   - the ticked boxes of the description's Tracker section, in the order
//     of the record.Check constants;
//   - the tracker.ceph.com tickets of the commits' Fixes: trailers in
//     commit order, then of the description, each once;
//   - the pull request the description's "backport of" names.
func Hints(messages []string, description string) *record.KindHints {
	h := record.KindHints{
		Checklist:  checklist(description),
		Tickets:    tickets(messages, description),
		BackportOf: backport(description),
	}
	if h.Checklist == nil && h.Tickets == nil && h.BackportOf == 0 {
		return nil
	}
	return &h
}

func checklist(description string) []string {
	ticked := map[string]bool{}
	for line := range strings.Lines(description) {
		m := tickedBox.FindStringSubmatch(strings.TrimRight(line, "\r\n"))
		if m == nil {
			continue
		}
		label := strings.ToLower(m[1])
		for _, b := range boxes {
			if strings.HasPrefix(label, b.label) {
				ticked[b.hint] = true
			}
		}
	}
	var out []string
	for _, b := range boxes {
		if ticked[b.hint] {
			out = append(out, b.hint)
		}
	}
	return out
}

func tickets(messages []string, description string) []int {
	var out []int
	seen := map[int]bool{}
	add := func(text string) {
		for _, m := range ticketURL.FindAllStringSubmatch(text, -1) {
			n, err := strconv.Atoi(m[1])
			if err != nil || n == 0 || seen[n] {
				continue
			}
			seen[n] = true
			out = append(out, n)
		}
	}
	for _, msg := range messages {
		for line := range strings.Lines(msg) {
			if m := fixesTrailer.FindStringSubmatch(strings.TrimSpace(line)); m != nil {
				add(m[1])
			}
		}
	}
	add(description)
	return out
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

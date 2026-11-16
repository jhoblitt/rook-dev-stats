package classify

import (
	"github.com/jhoblitt/rook-dev-stats/internal/fetch"
	"github.com/jhoblitt/rook-dev-stats/internal/record"
	"github.com/jhoblitt/rook-dev-stats/internal/tables"
)

// ownRepository is the repository the records are of, as an issue names
// its repository.
const ownRepository = fetch.Owner + "/" + fetch.Name

// ownKind is the kind a pull request's own hints and labels give, from the
// first source in kinds.yaml's order that gives one.
func ownKind(t *tables.Tables, r *record.Record) (kind, source string) {
	var h record.KindHints
	if r.KindHints != nil {
		h = *r.KindHints
	}
	for _, src := range t.Kinds.Order {
		switch src {
		case tables.SourceLabels:
			kind = agreed(r.Labels, t.Kinds.Labels)
		case tables.SourceIssues:
			kind = issuesKind(t, h.Issues)
		}
		if kind != "" {
			return kind, src
		}
	}
	return "", ""
}

// agreed is the kind the keys that m maps all name, or "" when none does
// or they disagree.
func agreed(keys []string, m map[string]string) string {
	kind := ""
	for _, k := range keys {
		to, ok := m[k]
		switch {
		case !ok:
		case kind == "":
			kind = to
		case kind != to:
			return ""
		}
	}
	return kind
}

// issuesKind is the kind of the first issue whose labels agree on one. An
// issue of another repository gives nothing: its labels are that
// project's, and may mean something else.
func issuesKind(t *tables.Tables, issues []record.Issue) string {
	for _, is := range issues {
		if is.Repository != ownRepository {
			continue
		}
		if kind := agreed(is.Labels, t.Kinds.IssueLabels); kind != "" {
			return kind
		}
	}
	return ""
}

// resolveOriginals gives each backport its original's kind, when the
// original is in recs and has one. A pull request whose backport_of chain
// leads back to itself keeps its own kind: the chain decides nothing.
func resolveOriginals(recs []record.Record, prs []PR) {
	at := make(map[int]int, len(recs))
	for i := range recs {
		at[recs[i].Number] = i
	}
	original := func(i int) (int, bool) {
		h := recs[i].KindHints
		if h == nil || h.BackportOf == 0 {
			return 0, false
		}
		j, ok := at[h.BackportOf]
		return j, ok
	}
	inCycle := func(i int) bool {
		seen := map[int]bool{}
		for j, ok := original(i); ok && !seen[j]; j, ok = original(j) {
			if j == i {
				return true
			}
			seen[j] = true
		}
		return false
	}

	type verdict struct{ kind, source string }
	own := make([]verdict, len(prs))
	for i := range prs {
		own[i] = verdict{prs[i].Kind, prs[i].KindSource}
	}
	done := make([]*verdict, len(prs))
	// resolve terminates: it recurses only from a pull request outside any
	// cycle, so the chain it walks never revisits one, and stops at a
	// pull request in a cycle, which keeps its own kind.
	var resolve func(i int) verdict
	resolve = func(i int) verdict {
		if done[i] != nil {
			return *done[i]
		}
		v := own[i]
		if j, ok := original(i); ok && !inCycle(i) {
			if o := resolve(j); o.kind != "" {
				v = verdict{o.kind, SourceOriginal}
			}
		}
		done[i] = &v
		return v
	}
	for i := range prs {
		v := resolve(i)
		prs[i].Kind, prs[i].KindSource = v.kind, v.source
	}
}

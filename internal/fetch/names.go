package fetch

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"slices"
	"strconv"
	"strings"
	"unicode"

	"github.com/jhoblitt/ceph-dev-stats/internal/ghapi"
)

// namesPerRequest is how many pull requests one CommitNames request asks
// for.
const namesPerRequest = 25

// CommitNames is what survives in git of an account GitHub has deleted: the
// names each of a pull request's commits records for its author and its
// committer, in GitHub's order of the commits. No address is kept.
type CommitNames struct {
	Commits []CommitName `json:"commits"`
}

// CommitName is one commit's names, each as cleanName leaves it; either is
// empty when GitHub gave none or cleanName dropped it.
type CommitName struct {
	OID       string `json:"oid"`
	Author    string `json:"author"`
	Committer string `json:"committer"`
}

// WebCommitter is the committer name GitHub records on a commit it makes
// itself through its web interface, such as a suggestion applied or the base
// branch merged in, whoever asked for it.
const WebCommitter = "GitHub"

// Name is who a deleted account's pull request is credited to: the most
// common committer name among its commits, leaving out WebCommitter, or,
// only when every commit's committer is WebCommitter, the most common
// author name. Committers rather than authors, since a backport keeps the
// authors of the commits it copies while its committer is whoever made it;
// so a committer whose name was dropped or never read, which the entry
// holds as "", rules the authors out, and with no other committer named the
// result is "". A tie goes to the name that appears on the earlier commit.
// Names are compared and returned as cleanName leaves them, so a name
// holding an address is never a candidate. It is "" when n is nil or no
// commit gives a name.
func (n *CommitNames) Name() string {
	if n == nil {
		return ""
	}
	committers, authors := make([]string, len(n.Commits)), make([]string, len(n.Commits))
	onlyWeb := true
	for i, c := range n.Commits {
		if name := cleanName(c.Committer); name != WebCommitter {
			committers[i] = name
			onlyWeb = false
		}
		authors[i] = cleanName(c.Author)
	}
	if onlyWeb {
		return mostCommon(authors)
	}
	return mostCommon(committers)
}

// cleanName is name without control or format characters, trimmed, with
// each run of whitespace one space, so that two spellings that look alike
// are one name and none renders deceptively. It is "" for a name holding an
// @: git's name is free text, and one that holds an @ may be an address.
func cleanName(name string) string {
	name = strings.Map(func(r rune) rune {
		switch {
		case unicode.IsSpace(r):
			// Before the controls are dropped, so that a tab or newline
			// between words still separates them.
			return ' '
		case unicode.IsControl(r) || unicode.Is(unicode.Cf, r):
			return -1
		}
		return r
	}, name)
	if strings.ContainsAny(name, "@\uFF20\uFE6B") {
		return ""
	}
	return strings.Join(strings.Fields(name), " ")
}

// mostCommon is the most frequent non-empty name, the earliest on a tie.
func mostCommon(names []string) string {
	counts := map[string]int{}
	for _, name := range names {
		if name != "" {
			counts[name]++
		}
	}
	best := ""
	for _, name := range names {
		if counts[name] > counts[best] {
			best = name
		}
	}
	return best
}

type gitActor struct {
	Name string `json:"name"`
}

func (a *gitActor) name() string {
	if a == nil {
		return ""
	}
	return a.Name
}

type nameNode struct {
	Commit struct {
		OID       string    `json:"oid"`
		Author    *gitActor `json:"author"`
		Committer *gitActor `json:"committer"`
	} `json:"commit"`
}

// askNames asks for the commits' names of the pull requests numbers, at most
// namesPerRequest of them, paging each one's commits to the end. Those GitHub
// can no longer resolve are left out of the names and returned apart.
func (w *walker) askNames(ctx context.Context, numbers []int) (map[int]*CommitNames, []*unresolvedError, error) {
	vars := map[string]any{"owner": Owner, "name": Name, "first": w.cfg.NestedPageSize}
	for i, n := range numbers {
		vars["n"+strconv.Itoa(i)] = n
	}
	var resp struct {
		Repository map[string]*struct {
			Commits *connection[nameNode] `json:"commits"`
		} `json:"repository"`
	}
	err := w.client.Do(ctx, ghapi.CommitNames(len(numbers)), vars, &resp)
	missing, ok := notFoundAliases(err, len(numbers))
	if !ok {
		return nil, nil, fmt.Errorf("asking commit names: %w", err)
	}
	out := make(map[int]*CommitNames, len(numbers))
	var unresolved []*unresolvedError
	for i, n := range numbers {
		if missing[i] {
			unresolved = append(unresolved, &unresolvedError{number: n, err: fmt.Errorf("asking commit names of pull request %d: %w", n, err)})
			continue
		}
		var first *connection[nameNode]
		if pr := resp.Repository["p"+strconv.Itoa(i)]; pr != nil {
			first = pr.Commits
		}
		nodes, err := pages(ctx, w, n, ghapi.Commits, ghapi.CommitNamesPage, first)
		if u, ok := errors.AsType[*unresolvedError](err); ok {
			unresolved = append(unresolved, u)
			continue
		}
		if err != nil {
			return nil, nil, fmt.Errorf("asking commit names: %w", err)
		}
		names := &CommitNames{Commits: make([]CommitName, len(nodes))}
		for j, nd := range nodes {
			names.Commits[j] = CommitName{
				OID: nd.Commit.OID, Author: cleanName(nd.Commit.Author.name()), Committer: cleanName(nd.Commit.Committer.name()),
			}
		}
		out[n] = names
	}
	return out, unresolved, nil
}

// aliasPath is where a CommitNames or PullRequestNumbers reply holds its
// i-th pull request.
func aliasPath(i int) string {
	return "repository.p" + strconv.Itoa(i)
}

// notFoundAliases returns which of a reply's n aliased pull requests err, the
// error of the request, says GitHub could not resolve. It is false when err
// is more than that: another error, or a NOT_FOUND anywhere else.
func notFoundAliases(err error, n int) (map[int]bool, bool) {
	if err == nil {
		return nil, true
	}
	nf, ok := errors.AsType[*ghapi.NotFoundError](err)
	if !ok {
		return nil, false
	}
	paths := map[string]bool{}
	for _, p := range nf.Paths {
		paths[p] = true
	}
	missing := map[int]bool{}
	for i := range n {
		if paths[aliasPath(i)] {
			missing[i] = true
		}
	}
	return missing, len(paths) > 0 && len(missing) == len(paths)
}

// completeNames gives their CommitNames to the cached entries of deleted
// accounts' pull requests that lack them, as entries written before entries
// carried names do. It passes over the cache only while meta.json does not
// record every such entry named. Each batch's entries are rewritten once
// the whole batch is answered, so an entry is either as it was or complete,
// and the next run completes whatever a failure left. An entry whose pull
// request GitHub can no longer resolve is left as it was, with a warning:
// no later pass could name it either.
func (w *walker) completeNames(ctx context.Context) error {
	switch m, err := ReadMeta(w.cfg.CacheDir); {
	case err == nil && m.DeletedAuthorsNamed:
		return nil
	case err != nil && !errors.Is(err, fs.ErrNotExist):
		return err
	}
	paths, err := cachedEntries(w.cfg.CacheDir)
	if err != nil {
		return err
	}
	var todo []int
	deleted, unnamed := 0, 0
	for _, p := range paths {
		e, err := readEntryFile(p)
		if err != nil {
			return err
		}
		if e.Author == nil || e.Author.Login != GhostLogin {
			continue
		}
		deleted++
		switch {
		case e.CommitNames == nil:
			todo = append(todo, e.Number)
		case e.CommitNames.Name() == "":
			unnamed++
		}
	}
	slices.Sort(todo)
	completed, unresolved := 0, 0
	for batch := range slices.Chunk(todo, namesPerRequest) {
		names, lost, err := w.askNames(ctx, batch)
		if err != nil {
			return err
		}
		for _, u := range lost {
			w.skipUnresolved(ctx, u)
		}
		unresolved += len(lost)
		for _, n := range batch {
			named, ok := names[n]
			if !ok {
				continue
			}
			e, err := ReadEntry(w.cfg.CacheDir, n)
			if err != nil {
				return err
			}
			e.CommitNames = named
			if err := writeJSON(entryPath(w.cfg.CacheDir, n), e); err != nil {
				return err
			}
			completed++
			if e.CommitNames.Name() == "" {
				unnamed++
			}
		}
	}
	w.log.InfoContext(ctx, "named deleted accounts' pull requests",
		slog.Int("deleted", deleted),
		slog.Int("completed", completed),
		slog.Int("unresolved", unresolved),
		slog.Int("without_name", unnamed))
	return nil
}

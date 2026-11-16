package fetch_test

import (
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/jhoblitt/ceph-dev-stats/internal/fetch"
)

// signed is commits whose committers and authors are the pairs given, in
// order, as {committer, author}.
func signed(pairs ...[2]string) *fetch.CommitNames {
	n := &fetch.CommitNames{Commits: []fetch.CommitName{}}
	for i, p := range pairs {
		n.Commits = append(n.Commits, fetch.CommitName{OID: sha(i), Committer: p[0], Author: p[1]})
	}
	return n
}

var _ = Describe("CommitNames.Name", func() {
	DescribeTable("credits a deleted account's pull request to",
		func(names *fetch.CommitNames, want string) {
			Expect(names.Name()).To(Equal(want))
		},
		Entry("the most common committer, not the authors a backport keeps",
			signed([2]string{"Ana Example", "Ben Example"}, [2]string{"Cy Example", "Ben Example"}, [2]string{"Ana Example", "Dee Example"}),
			"Ana Example"),
		Entry("a committer other than GitHub's web committer, however many commits that one made",
			signed([2]string{"GitHub", "Ana Example"}, [2]string{"GitHub", "Ana Example"}, [2]string{"Cy Example", "Ana Example"}),
			"Cy Example"),
		Entry("the most common author when every committer is GitHub's web committer",
			signed([2]string{"GitHub", "Ana Example"}, [2]string{"GitHub", "Ben Example"}, [2]string{"GitHub", "Ben Example"}),
			"Ben Example"),
		Entry("nothing, not the authors, when a committer was named but its name was dropped or never read",
			signed([2]string{"", "Ana Example"}, [2]string{"GitHub", "Ana Example"}),
			""),
		Entry("nothing, not the authors, when a committer's name is only whitespace and control characters",
			signed([2]string{" \t\x07 ", "Ana Example"}),
			""),
		Entry("nothing, not the authors, when the committers are the web committer and one whose name holds an @",
			signed([2]string{"GitHub", "Ana Example"}, [2]string{"x@example.com", "Ana Example"}, [2]string{"GitHub", "Ana Example"}),
			""),
		Entry("the earliest commit's committer on a tie",
			signed([2]string{"Ben Example", "x"}, [2]string{"Ana Example", "x"}, [2]string{"Ana Example", "x"}, [2]string{"Ben Example", "x"}),
			"Ben Example"),
		Entry("the earliest commit's author on a tie, when it falls back to the authors",
			signed([2]string{"GitHub", "Dee Example"}, [2]string{"GitHub", "Cy Example"}, [2]string{"GitHub", "Cy Example"}, [2]string{"GitHub", "Dee Example"}),
			"Dee Example"),
		Entry("a name trimmed and its inner whitespace collapsed, counted as one with its tidy spelling",
			signed([2]string{"  Ana \t Example ", "x"}, [2]string{"Ben Example", "x"}, [2]string{"Ana Example", "x"}),
			"Ana Example"),
		Entry("the web committer however it is spaced",
			signed([2]string{" GitHub ", "Ana Example"}),
			"Ana Example"),
		Entry("nothing, not the author a backport keeps, when the only committer name is a bare address",
			signed([2]string{"x@example.com", "Ana Example"}),
			""),
		Entry("nothing, not the author, when the only committer name carries an address in angle brackets",
			signed([2]string{"Ana Example <ana@example.com>", "Ben Example"}),
			""),
		Entry("nothing, not the author, when the only committer name carries an address in parentheses",
			signed([2]string{"Ana Example (ana@example.com)", "Ben Example"}),
			""),
		Entry("the less common committer, when the most common holds an @",
			signed([2]string{"ana@example.com", "x"}, [2]string{"ana@example.com", "x"}, [2]string{"Cy Example", "x"}),
			"Cy Example"),
		Entry("nothing, when the committers hold a full-width or small @, though the authors are named",
			signed([2]string{"ana\uFF20example.com", "x"}, [2]string{"ana\uFE6Bexample.com", "Ben Example"}, [2]string{"GitHub", "Ben Example"}),
			""),
		Entry("nothing, when every name holds an @",
			signed([2]string{"ana@example.com", "Ana <ana@example.com>"}, [2]string{"GitHub", "ben@example.com"}),
			""),
		Entry("a name with a zero-width joiner dropped, counted as one with its plain spelling",
			signed([2]string{"Ana\u200d Example", "x"}, [2]string{"Ben Example", "x"}, [2]string{"Ana Example", "x"}),
			"Ana Example"),
		Entry("a name with a bidi override dropped, counted as one with its plain spelling",
			signed([2]string{"\u202eAna Example", "x"}, [2]string{"Ben Example", "x"}, [2]string{"Ana Example", "x"}),
			"Ana Example"),
		Entry("a name with a C0 control dropped, counted as one with its plain spelling",
			signed([2]string{"Ana\x07 Example", "x"}, [2]string{"Ben Example", "x"}, [2]string{"Ana Example", "x"}),
			"Ana Example"),
		Entry("a newline between words read as one space",
			signed([2]string{"Ana\nExample", "x"}, [2]string{"Ben Example", "x"}, [2]string{"Ana Example", "x"}),
			"Ana Example"),
		Entry("nothing, when every name is empty or blank",
			signed([2]string{"GitHub", ""}, [2]string{"", "  "}),
			""),
		Entry("nothing, when no commit was returned", signed(), ""),
		Entry("nothing, when the names were never asked for", (*fetch.CommitNames)(nil), ""),
	)
})

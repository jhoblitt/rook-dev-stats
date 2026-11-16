package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

// The parser cases mirror conventional-commits-parser 6.4.0's note rule as
// the pinned conventionalcommits preset configures it: the line, after any
// run of white space, '|' or '*', starts with either keyword in any case and
// goes on with a colon or white space.
var _ = Describe("offendingLines", func() {
	DescribeTable("flags a line the parser takes for a breaking-change note",
		func(line string) {
			Expect(offendingLines(line)).To(ConsistOf(bodyLine{number: 1, text: line}), "line %q", line)
		},
		Entry("sentence-case prose that wraps the words onto the line start",
			"Breaking change in how the table sorts is unlikely."),
		Entry("a lowercase footer", "breaking change: none"),
		Entry("a Markdown table row", "| BREAKING CHANGE | none |"),
		Entry("the canonical footer", "BREAKING CHANGE: x"),
		Entry("the hyphenated footer", "BREAKING-CHANGE: x"),
		Entry("the hyphenated keyword in mixed case", "Breaking-Change: x"),
		Entry("a Markdown bullet", "* BREAKING CHANGE: x"),
		Entry("a pipe then a footer", "| breaking-change: x"),
		Entry("indentation mixing white space, pipes and asterisks", " \t*|* BREAKING CHANGE x"),
		Entry("a tab after the keyword", "BREAKING CHANGE\tx"),
		Entry("a colon and nothing after it", "BREAKING CHANGE:"),
		Entry("bold markup closed after the colon", "**BREAKING CHANGE:** x"),
		Entry("a no-break space before the keyword", " BREAKING CHANGE: x"),
		Entry("a no-break space after the keyword", "BREAKING CHANGE x"),
	)

	DescribeTable("leaves a line the parser ignores",
		func(line string) {
			Expect(offendingLines(line)).To(BeEmpty(), "line %q", line)
		},
		Entry("the words mid-sentence", "This is not a breaking change."),
		Entry("the keyword after other words", "no BREAKING CHANGE here"),
		// The keyword must be followed by a colon or white space, and S is
		// neither, so the plural is prose to the parser.
		Entry("the plural", "BREAKING CHANGES: x"),
		Entry("the words run together", "BREAKINGCHANGE: x"),
		Entry("two spaces between the words", "BREAKING  CHANGE: x"),
		Entry("a Markdown list dash", "- breaking change: none"),
		Entry("a block quote", "> BREAKING CHANGE: x"),
		Entry("bold markup closed before the colon", "**BREAKING CHANGE**: x"),
		// The parser needs at least one character after the keyword.
		Entry("the keyword alone", "BREAKING CHANGE"),
		// The parser splits on \r?\n, so a CRLF line ends at the keyword.
		Entry("the keyword alone before a carriage return", "BREAKING CHANGE\r"),
	)

	It("numbers each offending line within the body", func() {
		body := "Reworks the sort.\nBREAKING CHANGE: x\nmore prose\nbreaking-change y"

		Expect(offendingLines(body)).To(Equal([]bodyLine{
			{number: 2, text: "BREAKING CHANGE: x"},
			{number: 4, text: "breaking-change y"},
		}))
	})
})

var _ = Describe("run", func() {
	var base string

	BeforeEach(func() {
		GinkgoT().Setenv("GIT_CONFIG_GLOBAL", os.DevNull)
		GinkgoT().Setenv("GIT_CONFIG_NOSYSTEM", "1")
		GinkgoT().Setenv("GIT_AUTHOR_NAME", "spec")
		GinkgoT().Setenv("GIT_AUTHOR_EMAIL", "spec@example.invalid")
		GinkgoT().Setenv("GIT_COMMITTER_NAME", "spec")
		GinkgoT().Setenv("GIT_COMMITTER_EMAIL", "spec@example.invalid")
		GinkgoT().Chdir(GinkgoT().TempDir())

		gitDo("init", "-q", "-b", "main")
		base = commit("chore: start")
	})

	It("names the commit and quotes the line of an undeclared footer", func() {
		sha := commit("fix: sort the table\n\nReworks the sort.\nBREAKING CHANGE: drops the flag")

		code, stdout, stderr := runGuard(base, sha)

		Expect(code).To(Equal(1), "stdout:\n%s", stdout)
		Expect(stdout).To(Equal(sha[:8] + " declares no break in its subject but its body starts a line with the keyword:\n" +
			"  subject: fix: sort the table\n" +
			"  body line 2:BREAKING CHANGE: drops the flag\n"))
		Expect(stderr).To(Equal(guidance))
	})

	It("allows the footer when the subject declares the break", func() {
		commit("feat(site)!: drop the flag\n\nBREAKING CHANGE: the flag is gone")
		head := commit("docs: say the flag is gone")

		code, stdout, _ := runGuard(base, head)

		Expect(code).To(Equal(0), "stdout:\n%s", stdout)
		Expect(stdout).To(Equal("checked 2 commit(s): no undeclared breaking-change footers\n"))
	})

	It("checks a footer on the line right under the subject", func() {
		sha := commit("fix: sort the table\nBREAKING CHANGE: drops the flag")

		code, stdout, _ := runGuard(base, sha)

		Expect(code).To(Equal(1), "stdout:\n%s", stdout)
		Expect(stdout).To(ContainSubstring("  body line 1:BREAKING CHANGE: drops the flag\n"))
	})

	// The parser trims every leading and trailing CR and LF from the message
	// before it splits it into lines; git keeps them under --cleanup=verbatim.
	It("reads the subject from the first non-blank line", func() {
		head := commitVerbatim("\n\nfeat!: drop the flag\n\nBREAKING CHANGE: the flag is gone")

		code, stdout, _ := runGuard(base, head)

		Expect(code).To(Equal(0), "stdout:\n%s", stdout)
		Expect(stdout).To(Equal("checked 1 commit(s): no undeclared breaking-change footers\n"))
	})

	It("leaves the marker alone on a last line that ends in two carriage returns", func() {
		head := commitVerbatim("fix: sort the table\n\nBREAKING CHANGE\r\r")

		code, stdout, _ := runGuard(base, head)

		Expect(code).To(Equal(0), "stdout:\n%q", stdout)
	})

	It("checks a merge commit's message", func() {
		gitDo("checkout", "-q", "-b", "side")
		commit("docs: note the sort")
		gitDo("checkout", "-q", "main")
		commit("fix: sort the table")
		gitDo("merge", "-q", "--no-ff", "-m", "Merge branch 'side'\n\nbreaking change: none", "side")
		merge := gitOut("rev-parse", "HEAD")

		code, stdout, _ := runGuard(base, merge)

		Expect(code).To(Equal(1), "stdout:\n%s", stdout)
		Expect(stdout).To(HavePrefix(merge[:8] + " declares no break"))
		Expect(stdout).To(ContainSubstring("  body line 1:breaking change: none\n"))
	})
})

func commit(message string) string {
	GinkgoHelper()
	gitDo("commit", "-q", "--allow-empty", "-m", message)

	return gitOut("rev-parse", "HEAD")
}

func commitVerbatim(message string) string {
	GinkgoHelper()
	gitDo("commit", "-q", "--allow-empty", "--cleanup=verbatim", "-m", message)

	return gitOut("rev-parse", "HEAD")
}

func gitDo(args ...string) {
	GinkgoHelper()
	gitOut(args...)
}

func gitOut(args ...string) string {
	GinkgoHelper()
	out, err := exec.CommandContext(GinkgoT().Context(), "git", args...).CombinedOutput()
	Expect(err).NotTo(HaveOccurred(), "git %s: %s", strings.Join(args, " "), out)

	return strings.TrimSpace(string(out))
}

func runGuard(base, head string) (code int, stdout, stderr string) {
	GinkgoHelper()
	dir := GinkgoT().TempDir()
	outFile, err := os.Create(filepath.Join(dir, "stdout"))
	Expect(err).NotTo(HaveOccurred())
	DeferCleanup(outFile.Close)
	errFile, err := os.Create(filepath.Join(dir, "stderr"))
	Expect(err).NotTo(HaveOccurred())
	DeferCleanup(errFile.Close)

	code = run([]string{base, head}, outFile, errFile)

	outBytes, err := os.ReadFile(outFile.Name())
	Expect(err).NotTo(HaveOccurred())
	errBytes, err := os.ReadFile(errFile.Name())
	Expect(err).NotTo(HaveOccurred())

	return code, string(outBytes), string(errBytes)
}

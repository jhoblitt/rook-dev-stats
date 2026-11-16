// Command breaking-footer rejects a breaking-change footer the subject never
// declared. It is a template vendored into a target repository, where the
// commitlint workflow runs it over a pull request's commit range; that
// repository may have no Go module of its own, so this is one standalone
// stdlib-only file that `go run` accepts by name. The rule it enforces is
// owned by github-conventions, references/commits.md.
//
// conventional-commits-parser treats any line beginning with BREAKING CHANGE
// or BREAKING-CHANGE, followed by a colon or whitespace, as a footer — with no
// regard for whether it is prose. It tests each line after the header on its
// own, and matches the keyword in any case, after any run of whitespace, '*'
// or '|'. Body text that merely wraps the words onto the start of a line makes
// semantic-release cut a major release, silently.
// Requiring the subject to carry "!" as well makes the intent explicit, so
// accidental prose no longer looks like a deliberate break.
//
// This copy departs from the template: footerLine is widened to the parser's
// note rule, the body is every line after the first, and merges are checked.
// It still flags two kinds of line the parser lets pass, failing closed: a
// keyword spelled with U+212A KELVIN SIGN, which Go's (?i) folds to K and
// JavaScript's does not; and any line after one the parser's default field
// pattern matches (a hyphen, anything, a hyphen, such as "---"), since from
// there the parser appends every line to that field without testing it.
package main

import (
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strings"
)

// jsSpace is JavaScript's \s, which the parser's note pattern uses: Go's \s and
// [[:space:]] are ASCII only.
const jsSpace = `\t\n\v\f\r\p{Zs}\x{2028}\x{2029}\x{FEFF}`

var (
	footerLine   = regexp.MustCompile(`(?i)^[` + jsSpace + `|*]*BREAKING[ -]CHANGE[` + jsSpace + `:]`)
	declaredHead = regexp.MustCompile(`^[a-zA-Z]+(\([^)]*\))?!:`)
)

const guidance = `
Either declare the break in the subject (feat!: ...), or reword the body so the
keyword does not begin a line. semantic-release reads it as a footer either
way, and a major release cannot be undone without rewriting history.
`

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr *os.File) int {
	if len(args) != 2 {
		fmt.Fprintln(stderr, "usage: breaking-footer <base-sha> <head-sha>")
		return 2
	}

	// Merge commits are checked too: a squash merge's body is built from the
	// branch's commit messages, and a merge message is as editable as any.
	out, err := git("rev-list", args[0]+".."+args[1])
	if err != nil {
		fmt.Fprintln(stderr, "breaking-footer:", err)
		return 2
	}

	commits := lines(out)
	offenders := 0
	for _, sha := range commits {
		message, err := git("log", "-1", "--format=%B", sha)
		if err != nil {
			fmt.Fprintln(stderr, "breaking-footer:", err)
			return 2
		}
		// The parser trims every leading and trailing CR and LF, then takes the
		// first line alone as the header, not git's first paragraph, so a line
		// wrapped under the subject is body to it.
		subject, body, _ := strings.Cut(strings.Trim(message, "\r\n"), "\n")
		offending := offendingLines(strings.TrimLeft(body, "\r\n"))
		if len(offending) == 0 {
			continue
		}

		if declaredHead.MatchString(subject) {
			continue
		}

		fmt.Fprintf(stdout, "%s declares no break in its subject but its body starts a line with the keyword:\n", sha[:8])
		fmt.Fprintf(stdout, "  subject: %s\n", subject)
		for _, l := range offending {
			fmt.Fprintf(stdout, "  body line %d:%s\n", l.number, l.text)
		}
		offenders++
	}

	if offenders != 0 {
		fmt.Fprint(stderr, guidance)
		return 1
	}

	fmt.Fprintf(stdout, "checked %d commit(s): no undeclared breaking-change footers\n", len(commits))

	return 0
}

type bodyLine struct {
	number int
	text   string
}

func offendingLines(body string) []bodyLine {
	var offending []bodyLine
	for i, text := range strings.Split(body, "\n") {
		// The parser splits on \r?\n, so a carriage return is not white space
		// after the keyword to it.
		text = strings.TrimSuffix(text, "\r")
		if footerLine.MatchString(text) {
			offending = append(offending, bodyLine{number: i + 1, text: text})
		}
	}

	return offending
}

func git(args ...string) (string, error) {
	out, err := exec.Command("git", args...).Output()
	if err != nil {
		return "", fmt.Errorf("git %s: %w", strings.Join(args, " "), err)
	}

	return strings.TrimRight(string(out), "\n"), nil
}

func lines(out string) []string {
	if out == "" {
		return nil
	}

	return strings.Split(out, "\n")
}

package extract_test

import (
	"fmt"
	"strings"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/jhoblitt/rook-dev-stats/internal/extract"
	"github.com/jhoblitt/rook-dev-stats/internal/record"
)

// none is a Disclosure with no candidates.
func none() record.Disclosure {
	return record.Disclosure{Trailers: []string{}, Description: []string{}, CommitProse: []string{}}
}

func trailer(s string) record.Disclosure {
	d := none()
	d.Trailers = []string{s}
	return d
}

func prose(s string) record.Disclosure {
	d := none()
	d.CommitProse = []string{s}
	return d
}

func description(s string) record.Disclosure {
	d := none()
	d.Description = []string{s}
	return d
}

var _ = Describe("Candidates", func() {
	DescribeTable("a commit message line",
		func(line string, want record.Disclosure) {
			msg := "rgw: subject line\n\nSome body text.\n\n" + line + "\nSigned-off-by: Jane Roe <jane@example.com>\n"
			Expect(extract.Candidates([]string{msg}, "")).To(Equal(want), "line %q", line)
		},

		// Every trailer spelling in the design's Measurements.
		Entry("Assisted-by naming Claude Code", "Assisted-by: Claude Code", trailer("Assisted-by: Claude Code")),
		Entry("Assisted-by with a tool:model value", "Assisted-by: claude-code:claude-opus-4-6", trailer("Assisted-by: claude-code:claude-opus-4-6")),
		Entry("Assisted-by naming only an LLM", "Assisted-by: LLM", trailer("Assisted-by: LLM")),
		Entry("Assisted-by naming IBM Bob with a version", "Assisted-by: IBM Bob 2.3.0", trailer("Assisted-by: IBM Bob 2.3.0")),
		Entry("Assisted-by naming Codex and GPT", "Assisted-by: Codex (GPT-6)", trailer("Assisted-by: Codex (GPT-6)")),
		Entry("Assisted-by naming Gemini", "Assisted-by: Gemini", trailer("Assisted-by: Gemini")),
		Entry("Assisted-by naming Cursor with its address", "Assisted-by: Cursor <cursoragent@cursor.com>", trailer("Assisted-by: Cursor <cursoragent@cursor.com>")),
		Entry("Assisted-by in any case, naming a tool not on the list", "ASSISTED-BY: Tabnine", trailer("ASSISTED-BY: Tabnine")),
		Entry("the Assistant-By near miss", "Assistant-By: Claude", trailer("Assistant-By: Claude")),
		Entry("the Claude-Session near miss, kept by its key", "Claude-Session: 01JABCDEF", trailer("Claude-Session: 01JABCDEF")),
		Entry("Co-authored-by naming Claude", "Co-authored-by: Claude <noreply@anthropic.com>", trailer("Co-authored-by: Claude <noreply@anthropic.com>")),
		Entry("Co-authored-by naming Copilot", "Co-authored-by: Copilot <175728472+Copilot@users.noreply.github.com>", trailer("Co-authored-by: Copilot <175728472+Copilot@users.noreply.github.com>")),
		Entry("a -by trailer whose value is only Cursor", "Assisted-by: Cursor", trailer("Assisted-by: Cursor")),
		Entry("a trailer with leading whitespace, trimmed", "   Assisted-by: Gemini CLI  ", trailer("Assisted-by: Gemini CLI")),

		// People and never-kept keys.
		Entry("Co-authored-by naming a person", "Co-authored-by: Ana Smith <ana@example.com>", none()),
		Entry("Signed-off-by naming a person called Claude", "Signed-off-by: Claude Dupont <c@example.com>", none()),
		Entry("Reviewed-by naming Copilot", "Reviewed-by: Copilot", none()),
		Entry("Link to an assistant's site", "Link: https://claude.ai/share/0000", none()),
		Entry("Fixes naming an issue", "Fixes: https://github.com/rook/rook/issues/12345", none()),

		// Prose, and trailer-shaped lines that are not kept as trailers.
		Entry("the prose near miss", "Assisted by Claude Opus-5.5", prose("Assisted by Claude Opus-5.5")),
		Entry("a tool's name alone, kept for a later verdict", "Address Copilot review comments", prose("Address Copilot review comments")),
		Entry("a non -by trailer whose value matches", "Model: claude-opus-5-5", prose("Model: claude-opus-5-5")),
		Entry("a component-prefixed subject naming AI", "doc: say how AI tools may be used", prose("doc: say how AI tools may be used")),
		Entry("LLM as a word", "the llm suggested this loop", prose("the llm suggested this loop")),
		Entry("GPT followed by a digit", "compare against gpt4o output", prose("compare against gpt4o output")),
		Entry("GPT as a word, generous on purpose", "probe the GPT partition table", prose("probe the GPT partition table")),
		Entry("Cursor's address in prose", "drafted with cursoragent@cursor.com", prose("drafted with cursoragent@cursor.com")),

		// False friends.
		Entry("a RADOS cursor function", "Use list_nobjects_get_cursor() to resume listing", none()),
		Entry("cursor as a plain word", "move the cursor past the last key", none()),
		Entry("ai inside lower-case words", "maintain the aio completion path", none()),
		Entry("AI only as part of a longer word", "AIO and RAID paths are untouched", none()),
		Entry("gpt inside a word", "gptfdisk is not installed", none()),
		Entry("llm inside a word", "fillmore street", none()),
		Entry("aider inside a word", "the raider thread stops at shutdown", none()),
		Entry("anthropic inside a word", "a philanthropic default for the cache size", none()),
		Entry("generated with inside regenerated without", "the unit file is regenerated without the stale mount", none()),
		Entry("aider as a word", "drafted with aider", prose("drafted with aider")),
		Entry("Anthropic as a word", "an Anthropic model wrote the first draft", prose("an Anthropic model wrote the first draft")),
		Entry("re-generated with, generous on purpose", "keys are re-generated with the new cipher", prose("keys are re-generated with the new cipher")),
	)

	DescribeTable("a PR description line",
		func(line string, want record.Disclosure) {
			body := "**Description of your changes:**\r\n\r\n" + line + "\r\n\r\n**Checklist:**\r\n\r\n- [x] Documentation has been updated, if necessary.\r\n"
			Expect(extract.Candidates(nil, body)).To(Equal(want), "line %q", line)
		},

		// Every description form in the design's Measurements.
		Entry("Assisted by, in prose", "Assisted by Claude Code (Opus 5.5)", description("Assisted by Claude Code (Opus 5.5)")),
		Entry("Generated with", "🤖 Generated with [Claude Code](https://claude.com/claude-code)", description("🤖 Generated with [Claude Code](https://claude.com/claude-code)")),
		Entry("Raised by", "🤖 Raised by [Claude Code](https://claude.com/claude-code)", description("🤖 Raised by [Claude Code](https://claude.com/claude-code)")),
		Entry("a Disclosure: line", "Disclosure: parts of this were prepared with the help of Claude Code", description("Disclosure: parts of this were prepared with the help of Claude Code")),
		Entry("an LLM, in a sentence", "I made this fix with an LLM", description("I made this fix with an LLM")),
		Entry("a tool's name alone, kept for a later verdict", "This adds a Copilot review skill", description("This adds a Copilot review skill")),
		Entry("an Assisted-by trailer pasted into the description", "Assisted-by: Gemini", description("Assisted-by: Gemini")),

		// False friends.
		Entry("a never-kept trailer naming a person called Claude", "Signed-off-by: Claude Dupont <c@example.com>", none()),
		Entry("a RADOS cursor function", "calls list_nobjects_get_cursor() once per page", none()),
	)

	Describe("the AI-guidelines box", func() {
		const (
			ticked   = "- [x] Reviewed [AI guidelines](https://rook.io/docs/rook/latest/Contributing/ai-guidelines), if AI assisted with the PR."
			unticked = "- [ ] Reviewed [AI guidelines](https://rook.io/docs/rook/latest/Contributing/ai-guidelines), if AI assisted with the PR."
		)
		// body is a description in the template's shape, line among its
		// checklist.
		body := func(lines ...string) string {
			return "**Description of your changes:**\r\n\r\nFix the leak.\r\n\r\n**Checklist:**\r\n\r\n" +
				"- [x] Documentation has been updated, if necessary.\r\n" + strings.Join(lines, "\r\n") + "\r\n"
		}
		checklist := func(lines ...string) record.Disclosure {
			d := none()
			d.Checklist = true
			if lines != nil {
				d.Description = lines
			}
			return d
		}

		It("sets Checklist for the ticked template line, which is no description candidate", func() {
			Expect(extract.Candidates(nil, body(ticked))).To(Equal(checklist()))
		})

		It("yields neither for the unticked template line", func() {
			Expect(extract.Candidates(nil, body(unticked))).To(Equal(none()))
		})

		It("leaves Checklist false for a description with no box, as in 2016", func() {
			got, _ := extract.Candidates(nil, "Generated with Claude Code\r\n- [x] Unit tests have been added, if necessary.\r\n")
			Expect(got).To(Equal(description("Generated with Claude Code")))
			Expect(got.Checklist).To(BeFalse())
		})

		It("yields both for a ticked box and a disclosure sentence", func() {
			const sentence = "AI disclosure: Claude Code helped trace the leak; I reviewed every line."
			Expect(extract.Candidates(nil, body(ticked)+"\r\n"+sentence+"\r\n")).To(Equal(checklist(sentence)))
		})

		DescribeTable("takes any checklist line whose label starts with reviewed and holds AI guidelines for the box",
			func(line string, want record.Disclosure) {
				Expect(extract.Candidates(nil, body(line))).To(Equal(want), "line %q", line)
			},
			Entry("ticked with an upper-case X", "- [X] Reviewed [AI guidelines](https://rook.io/docs/rook/latest/Contributing/ai-guidelines), if AI assisted with the PR.", checklist()),
			Entry("ticked with a space inside the box", "- [X ] Reviewed [AI guidelines](https://rook.io/docs/rook/latest/Contributing/ai-guidelines), if AI assisted with the PR.", checklist()),
			Entry("ticked, the link dropped", "- [x] Reviewed AI guidelines, if AI assisted with the PR.", checklist()),
			Entry("ticked, without a bullet", "[x] Reviewed AI guidelines", checklist()),
			Entry("ticked, with an asterisk bullet", "* [x] reviewed ai guidelines.", checklist()),
			Entry("unticked, the link dropped", "- [ ] Reviewed AI guidelines, if AI assisted with the PR.", none()),
			Entry("ticked, naming another guide beside it", "- [x] Reviewed developer guide and AI guidelines.", checklist()),
			Entry("ticked, followed by Mergify's sentence when the box ends the original's description",
				"- [x] Reviewed [AI guidelines](https://rook.io/docs/rook/latest/Contributing/ai-guidelines), if AI assisted with the PR.<hr>This is an automatic backport of pull request #1 done by [Mergify](https://mergify.com).",
				checklist()),

			// A box line that says more than the template is a candidate too:
			// the tables decide whether what it adds counts.
			Entry("ticked, saying how AI assisted",
				"- [x] Reviewed AI guidelines. AI assistance was used for repository navigation.",
				checklist("- [x] Reviewed AI guidelines. AI assistance was used for repository navigation.")),
			Entry("ticked, with the template's words and a statement after them",
				"- [x] Reviewed [AI guidelines](https://rook.io/docs/rook/latest/Contributing/ai-guidelines), if AI assisted with the PR. (Prepared with AI assistance; minimal fix.)",
				checklist("- [x] Reviewed [AI guidelines](https://rook.io/docs/rook/latest/Contributing/ai-guidelines), if AI assisted with the PR. (Prepared with AI assistance; minimal fix.)")),
			Entry("ticked, saying that AI assisted rather than if it did",
				"- [x] Reviewed AI guidelines, since AI assisted with the PR.",
				checklist("- [x] Reviewed AI guidelines, since AI assisted with the PR.")),
			Entry("ticked, a phrase among the words before the AI guidelines",
				"- [x] Reviewed the code generated with copilot and ai guidelines",
				checklist("- [x] Reviewed the code generated with copilot and ai guidelines")),
			Entry("ticked, AI-generated code named before the AI guidelines",
				"- [x] Reviewed AI generated code and AI guidelines.",
				checklist("- [x] Reviewed AI generated code and AI guidelines.")),
			Entry("unticked, saying more",
				"- [ ] Reviewed AI guidelines (AI assisted with the PR).",
				description("- [ ] Reviewed AI guidelines (AI assisted with the PR).")),
		)

		DescribeTable("is not",
			func(line string, want record.Disclosure) {
				Expect(extract.Candidates(nil, body(line))).To(Equal(want), "line %q", line)
			},
			Entry("a line about the guidelines that is not a checklist line", "Reviewed the AI guidelines with the team.", description("Reviewed the AI guidelines with the team.")),
			Entry("a checklist line whose label does not start with reviewed", "- [x] Read the AI guidelines", description("- [x] Read the AI guidelines")),
			Entry("a checklist line that does not name the AI guidelines", "- [x] Reviewed the AI output", description("- [x] Reviewed the AI output")),
		)

		It("is read only in the description, never in a commit message", func() {
			msg := "rgw: fix\n\n- [x] Reviewed AI guidelines, if AI assisted with the PR.\n"
			Expect(extract.Candidates([]string{msg}, "")).To(Equal(prose("- [x] Reviewed AI guidelines, if AI assisted with the PR.")))
		})
	})

	Describe("an address, or what may be one", func() {
		// commit is a commit message carrying line among its trailers.
		commit := func(line string) []string {
			return []string{"rgw: subject line\n\nSome body text.\n\n" + line + "\nSigned-off-by: Jane Roe <jane@example.com>\n"}
		}

		DescribeTable("keeps a line whose only addresses are tools'",
			func(messages []string, description string, want record.Disclosure) {
				Expect(extract.Candidates(messages, description)).To(Equal(want))
			},
			Entry("Claude Code's", commit("Co-authored-by: Claude Opus 4.6 <noreply@anthropic.com>"), "",
				trailer("Co-authored-by: Claude Opus 4.6 <noreply@anthropic.com>")),
			Entry("Claude Code's in another case", commit("Co-Authored-By: Claude <NoReply@Anthropic.com>"), "",
				trailer("Co-Authored-By: Claude <NoReply@Anthropic.com>")),
			Entry("Claude Code's without its closing bracket, as some commits have it", commit("Co-Authored-By: Claude Opus 5.0 <noreply@anthropic.com"), "",
				trailer("Co-Authored-By: Claude Opus 5.0 <noreply@anthropic.com")),
			Entry("Claude Code's, misspelled in one commit", commit("Assisted-by: Claude Fable 5.1 <norpley@anthropic.com>"), "",
				trailer("Assisted-by: Claude Fable 5.1 <norpley@anthropic.com>")),
			Entry("Cursor's agent's", commit("Co-authored-by: Cursor Agent <cursoragent@cursor.com>"), "",
				trailer("Co-authored-by: Cursor Agent <cursoragent@cursor.com>")),
			Entry("IBM Bob's", commit("Assisted-by: Bob <bob@ibm.com>"), "",
				trailer("Assisted-by: Bob <bob@ibm.com>")),
			Entry("Copilot Autofix's GitHub no-reply", commit("Co-authored-by: Copilot Autofix powered by AI <175728472+Copilot@users.noreply.github.com>"), "",
				trailer("Co-authored-by: Copilot Autofix powered by AI <175728472+Copilot@users.noreply.github.com>")),
			Entry("Copilot's other GitHub no-reply", commit("Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"), "",
				trailer("Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>")),
			Entry("a tool's address in prose", commit("drafted with cursoragent@cursor.com"), "",
				prose("drafted with cursoragent@cursor.com")),
			Entry("a mention after a space", nil, "Thanks @claude for the review", description("Thanks @claude for the review")),
			Entry("a mention at the start of a line", nil, "@copilot please review", description("@copilot please review")),
		)

		DescribeTable("keeps a Co-authored-by with a tool's address in every tolerated spelling of its key",
			func(line string) {
				Expect(extract.Candidates(nil, line)).To(Equal(description(line)), "line %q", line)
			},
			Entry("no space after the colon", "Co-authored-by:Claude <noreply@anthropic.com>"),
			Entry("a space before the colon", "Co-authored-by : Claude <noreply@anthropic.com>"),
			Entry("spaces in place of the hyphens", "Co authored by: Claude <noreply@anthropic.com>"),
			Entry("upper case", "CO-AUTHORED-BY: Claude <noreply@anthropic.com>"),
			Entry("in bold, the colon inside", "**Co-authored-by:** Claude <noreply@anthropic.com>"),
			Entry("in code marks", "`Co-authored-by: Claude <noreply@anthropic.com>`"),
			Entry("in emphasis", "_Co-authored-by: Claude <noreply@anthropic.com>_"),
			Entry("behind a list marker without a space", "-Co-authored-by: Claude <noreply@anthropic.com>"),
			Entry("behind a bullet", "• Co-authored-by: Claude <noreply@anthropic.com>"),
			Entry("in a table cell", "| Co-authored-by: Claude <noreply@anthropic.com> |"),
			Entry("behind a quote and a list marker", "> - Co-authored-by: Claude <noreply@anthropic.com>"),
		)

		DescribeTable("keeps nowhere a line with what may be an address that is not a tool's, and counts it",
			func(messages []string, description, key string) {
				got, withheld := extract.Candidates(messages, description)
				Expect(got).To(Equal(none()))
				Expect(withheld).To(Equal(map[string]int{key: 1}))
			},
			// The trailer shapes the first rule missed.
			Entry("a Co-authored-by naming a person called Claude", commit("Co-authored-by: Claude Dupont <claude.dupont@example.com>"), "", "example.com"),
			Entry("no space after the colon nor before the address", nil, "Co-authored-by:Claude Dupont<cd@example.com>", "example.com"),
			Entry("a space before the colon", nil, "Co-authored-by : Claude Dupont <cd@example.com>", "example.com"),
			Entry("spaces in place of the hyphens", nil, "Co authored by: Claude Dupont <cd@example.com>", "example.com"),
			Entry("in bold", nil, "**Co-authored-by:** Claude Dupont <cd@example.com>", "example.com"),
			Entry("in code marks", nil, "`Co-authored-by: Claude Dupont <cd@example.com>`", "example.com"),
			Entry("in emphasis", nil, "_Co-authored-by: Claude Dupont <cd@example.com>_", "example.com"),
			Entry("behind a list marker without a space", nil, "-Co-authored-by: Claude Dupont <cd@example.com>", "example.com"),
			Entry("behind a bullet", nil, "• Co-authored-by: Claude Dupont <cd@example.com>", "example.com"),
			Entry("in a table cell", nil, "| Co-authored-by: Claude Dupont <cd@example.com> |", "example.com"),
			Entry("behind a list marker", nil, "- Co-authored-by: Claude Dupont <cd@example.com>", "example.com"),
			Entry("behind a quote marker", nil, "> Co-authored-by: Claude Dupont <cd@example.com>", "example.com"),
			Entry("behind a numbered-list marker", nil, "1. Co-authored-by: Claude Dupont <cd@example.com>", "example.com"),
			Entry("behind a quote and a list marker, in a commit", commit("> - Co-authored-by: Claude Dupont <cd@example.com>"), "", "example.com"),
			Entry("a key not ending in -by", commit("Original-Author: Claude X <x@y>"), "", "y"),
			Entry("a person at anthropic.com", commit("Co-authored-by: Ana Smith <ana.smith@anthropic.com>"), "", "anthropic.com"),
			Entry("a person at openai.com in another -by trailer", commit("Assisted-by: Jo Doe <jo@openai.com>"), "", "openai.com"),
			Entry("a person beside a tool", commit("Co-authored-by: Claude <noreply@anthropic.com>, Ana <ana@example.com>"), "", "example.com"),
			Entry("a person whose local part holds a tool's address", commit("Co-authored-by: Claude <xnoreply@anthropic.com>"), "", "anthropic.com"),

			// Addresses in prose, the domain counted in lower case.
			Entry("a bare address in prose", commit("drafted with Claude, questions to Ana@Example.COM"), "", "example.com"),
			Entry("an address in angle brackets in a description", nil, "Generated with Claude by the team <team@example.com>", "example.com"),
			Entry("a person's address beside a tool's", nil, "Generated with Claude <noreply@anthropic.com>, reviewed by ana@example.com", "example.com"),
			Entry("a list item that is not a trailer", nil, "- drafted with Claude, questions to ana@example.com", "example.com"),
			Entry("an address encoded in a URL", nil, "Generated with [Claude](https://claude.ai/x?email=a%40b.com)", "b.com"),
			Entry("a local part that is not ASCII", nil, "Claude josé@example.com", "example.com"),
			Entry("a domain without a dot", nil, "Claude cd@localhost", "localhost"),
			Entry("a tool's version, which may be an address", commit("Assisted-by: claude-code@2.0.14"), "", "2.0.14"),
			Entry("a domain that is not a plain domain", nil, "Generated with Claude, ask a@b_c.com", "other"),
		)

		DescribeTable("keeps nowhere a Co-authored-by without a tool's address, or with text after it",
			func(messages []string, description, key string) {
				got, withheld := extract.Candidates(messages, description)
				Expect(got).To(Equal(none()))
				Expect(withheld).To(Equal(map[string]int{key: 1}))
			},
			Entry("a name with no address", commit("Co-authored-by: Claude Dupont"), "", "no address"),
			Entry("only a tool's name", commit("Co-authored-by: Cursor"), "", "no address"),
			Entry("a person's name after a tool's address", commit("Co-authored-by: Claude <noreply@anthropic.com>, Ana Smith"), "", "anthropic.com"),
			Entry("in a description, in bold", nil, "**Co-authored-by:** Claude Dupont", "no address"),
		)

		It("keeps another -by trailer without an address as it is", func() {
			Expect(extract.Candidates(commit("Assisted-by: Claude Sonnet 4.5"), "")).To(Equal(trailer("Assisted-by: Claude Sonnet 4.5")))
		})

		It("counts each line it keeps nowhere", func() {
			_, withheld := extract.Candidates(
				[]string{
					"a: one\n\nCo-authored-by: Claude Dupont <claude.dupont@example.com>\n",
					"a: two\n\nCo-authored-by: Claude Dupont <claude.dupont@example.com>\nAssisted-by: Jo Doe <jo@openai.com>\n",
				},
				"Co-authored-by: Claude Dupont <claude.dupont@example.com>\n")

			Expect(withheld).To(Equal(map[string]int{"example.com": 3, "openai.com": 1}))
		})

		It("counts nothing for a line with an address that would not be kept anyway", func() {
			Expect(extract.Candidates(commit("Co-authored-by: Ana Smith <ana@example.com>"), "Thanks: Ana <ana@example.com>")).To(Equal(none()))
		})

		It("counts a domain longer than a domain can be as other", func() {
			_, withheld := extract.Candidates(nil, "Generated with Claude, ask a@"+strings.Repeat("b", 250)+".com")

			Expect(withheld).To(Equal(map[string]int{"other": 1}))
		})

		DescribeTable("withholds an address that holds a tool's after or before other text",
			func(line, key string) {
				got, withheld := extract.Candidates(nil, line)
				Expect(got).To(Equal(none()), "line %q", line)
				Expect(withheld).To(Equal(map[string]int{key: 1}), "line %q", line)
			},
			Entry("after a !", "Co-authored-by: Ana Smith <ana!noreply@anthropic.com>", "anthropic.com"),
			Entry("after a =", "Co-authored-by: Ana Smith <ana=noreply@anthropic.com>", "anthropic.com"),
			Entry("after a /", "Co-authored-by: Ana Smith <ana/noreply@anthropic.com>", "anthropic.com"),
			Entry("after a letter that is not ASCII", "Co-authored-by: José <josénoreply@anthropic.com>", "anthropic.com"),
			Entry("Copilot's after a letter that is not ASCII", "Ana <é175+Copilot@users.noreply.github.com>", "users.noreply.github.com"),
			Entry("after a person's @, in a trailer", "Co-authored-by: Ana Smith <ana.smith@noreply@anthropic.com>", "other"),
			Entry("after a person's @, in prose", "drafted with Claude, ana.smith@noreply@anthropic.com", "other"),
			Entry("running on into a longer domain", "drafted with Claude, noreply@anthropic.com.evil.example", "anthropic.com.evil.example"),
		)

		DescribeTable("finds the Co-authored-by key anywhere and however spelled, and keeps it only with a tool alone",
			func(format string) {
				person := fmt.Sprintf(format, "Claude Dupont")
				got, withheld := extract.Candidates(nil, person)
				Expect(got).To(Equal(none()), "line %q", person)
				Expect(withheld).To(Equal(map[string]int{"no address": 1}), "line %q", person)

				tool := fmt.Sprintf(format, "Claude <noreply@anthropic.com>")
				Expect(extract.Candidates(nil, tool)).To(Equal(description(tool)), "line %q", tool)
			},
			Entry("behind a heading mark", "## Co-authored-by: %s"),
			Entry("behind a checkbox", "- [x] Co-authored-by: %s"),
			Entry("in an HTML list item", "<li>Co-authored-by: %s</li>"),
			Entry("in a second table cell", "| pairing | Co-authored-by: %s |"),
			Entry("mid-line", "This change was Co-authored-by: %s"),
			Entry("spelled Coauthored-by", "Coauthored-by: %s"),
			Entry("with en dashes", "Co–authored–by: %s"),
			Entry("with non-breaking hyphens", "Co‑authored‑by: %s"),
			Entry("with a soft hyphen inside a word", "Co-au\u00adthored-by: %s"),
			Entry("with a zero-width space inside a word", "Co-auth\u200bored-by: %s"),
			Entry("with a word joiner inside a word", "Co-authored-b\u2060y: %s"),
			Entry("with a full-width colon", "Co-authored-by\uff1a %s"),
		)

		DescribeTable("withholds a Co-authored-by that names more than the tool",
			func(line, key string) {
				got, withheld := extract.Candidates(nil, line)
				Expect(got).To(Equal(none()), "line %q", line)
				Expect(withheld).To(Equal(map[string]int{key: 1}), "line %q", line)
			},
			Entry("a person's name before the tool, after a comma", "Co-authored-by: Ana Smith, Claude <noreply@anthropic.com>", "anthropic.com"),
			Entry("a person's name before the tool, after and", "Co-authored-by: Ana Smith and Claude <noreply@anthropic.com>", "anthropic.com"),
			Entry("a person's name before the tool, after a slash", "Co-authored-by: Ana Smith / Claude <noreply@anthropic.com>", "anthropic.com"),
			Entry("two tools' addresses", "Co-authored-by: Claude <noreply@anthropic.com> Cursor <cursoragent@cursor.com>", "cursor.com"),
			Entry("a mention of the key with no address", "Do not attribute an AI tool with Co-authored-by. Describe tool use in", "no address"),
		)

		DescribeTable("reads a full-width or small @ as an @",
			func(line string) {
				got, withheld := extract.Candidates(nil, line)
				Expect(got).To(Equal(none()), "line %q", line)
				Expect(withheld).To(Equal(map[string]int{"example.com": 1}), "line %q", line)
			},
			Entry("full-width", "Co-authored-by: Claude Dupont <cd\uff20example.com>"),
			Entry("small", "Generated with Claude, ask cd\ufe6bexample.com"),
		)

		DescribeTable("withholds an address that only holds a tool's, with a name or alone in prose",
			func(address, key string) {
				for _, line := range []string{"Co-authored-by: Claude Dupont <" + address + ">", "drafted with Claude, " + address} {
					got, withheld := extract.Candidates(nil, line)
					Expect(got).To(Equal(none()), "line %q", line)
					Expect(withheld).To(Equal(map[string]int{key: 1}), "line %q", line)
				}
			},
			Entry("after an underscore", "jim_bob@ibm.com", "ibm.com"),
			Entry("after an underscore, Claude Code's", "ana_noreply@anthropic.com", "anthropic.com"),
			Entry("after an apostrophe", "o'bob@ibm.com", "ibm.com"),
			Entry("after an asterisk", "a*noreply@anthropic.com", "anthropic.com"),
		)

		// A substring, prefix or suffix match of a tool's address would keep
		// each of these.
		DescribeTable("compares a whole token with the tools' addresses, never a part of one",
			func(token string) {
				line := "drafted with Claude, " + token
				got, withheld := extract.Candidates(nil, line)
				Expect(got).To(Equal(none()), "line %q", line)
				Expect(withheld).To(HaveLen(1), "line %q", line)
			},
			Entry("text before the address", "xnoreply@anthropic.com"),
			Entry("text after the address", "noreply@anthropic.comx"),
			Entry("a domain running on", "noreply@anthropic.com.evil.example"),
			Entry("text on both sides", "xbob@ibm.comx"),
			Entry("text before Copilot's", "x175728472+Copilot@users.noreply.github.com"),
			Entry("text after Copilot's", "175728472+Copilot@users.noreply.github.com.evil"),
		)

		DescribeTable("keeps a tool's address wrapped in emphasis or code marks",
			func(line string) {
				Expect(extract.Candidates(nil, line)).To(Equal(description(line)), "line %q", line)
			},
			Entry("underscores", "Co-authored-by: Claude _noreply@anthropic.com_"),
			Entry("asterisks", "Co-authored-by: Claude *noreply@anthropic.com*"),
			Entry("backticks", "Co-authored-by: Claude `noreply@anthropic.com`"),
			Entry("followed by a closing list-item tag", "Co-authored-by: Claude <noreply@anthropic.com></li>"),
			Entry("after a full-width colon and no space", "Co-authored-by\uff1anoreply@anthropic.com"),
		)

		DescribeTable("withholds a Co-authored-by key in any form it takes, with a name",
			func(line, key string) {
				got, withheld := extract.Candidates(nil, line)
				Expect(got).To(Equal(none()), "line %q", line)
				Expect(withheld).To(Equal(map[string]int{key: 1}), "line %q", line)
			},
			Entry("in underscore emphasis, the colon inside", "_Co-authored-by:_ Claude Dupont", "no address"),
			Entry("in strong underscore emphasis", "__Co-authored-by__: Claude Dupont", "no address"),
			Entry("the whole line in underscore emphasis", "_Co-authored-by: Claude Dupont_", "no address"),
			Entry("with underscores for hyphens, in capitals", "CO_AUTHORED_BY: Claude Dupont", "no address"),
			Entry("twice, a name in the half without an address", "Co-authored-by: Claude Dupont Co-authored-by: Claude <noreply@anthropic.com>", "anthropic.com"),
			Entry("a tool's address followed by a tag naming a person", "Co-authored-by: Claude <noreply@anthropic.com></AnaSmith>", "anthropic.com"),
			Entry("a non-breaking space inside the address", "Co-authored-by: Claude Dupont <claude\u00a0dupont@example.com>", "example.com"),
			Entry("a name before the tool, after with", "Co-authored-by: Ana Smith with Claude <noreply@anthropic.com>", "anthropic.com"),
			Entry("a name before the tool, after a plus", "Co-authored-by: Ana Smith + Claude <noreply@anthropic.com>", "anthropic.com"),
		)

		DescribeTable("keeps a mention, which is not an address",
			func(line string) {
				Expect(extract.Candidates(nil, line)).To(Equal(description(line)), "line %q", line)
			},
			Entry("in parentheses", "(@claude)"),
			Entry("in parentheses after text", "Generated with Claude (@claude)"),
			Entry("in backticks", "`@claude`"),
			Entry("in double quotes", "\"@claude\""),
			Entry("in emphasis", "*@claude*"),
			Entry("after a space", "Thanks @claude"),
			Entry("at the start of a line", "@claude please review"),
			Entry("a scoped package", "Bump @anthropic-ai/sdk"),
		)

		DescribeTable("takes an @ that does not start a mention for an address",
			func(line, key string) {
				got, withheld := extract.Candidates(nil, line)
				Expect(got).To(Equal(none()), "line %q", line)
				Expect(withheld).To(Equal(map[string]int{key: 1}), "line %q", line)
			},
			Entry("an @ alone between spaces", "Generated with Claude @ 3am", "other"),
			Entry("two @ at the start", "Claude, ask @@claude", "other"),
			Entry("a second @ in the token", "Claude, ask @a@b", "other"),
			Entry("a %40 in the token", "Claude, ask @x%40y", "other"),
			Entry("a mention defused by GitHub after a tag", "Generated with Claude by <code>@\u200bCopilot</code>", "copilot"),
			Entry("after a > that follows a space", "Generated with Claude >@claude", "claude"),
			Entry("after a > at the start of a line", ">@claude drafted this", "claude"),
			Entry("after a non-breaking space", "Generated with Claude\u00a0@claude", "claude"),
			Entry("after an ideographic space", "Generated with Claude\u3000@claude", "claude"),
		)

		// Each cuts a person's address at a split rune so that what is left
		// of it would pass for a mention.
		DescribeTable("withholds an address cut where a mention could be read",
			func(fragment, key string) {
				for _, line := range []string{
					"drafted with Claude, " + fragment,
					"Co-authored-by: Claude <noreply@anthropic.com> " + fragment,
				} {
					got, withheld := extract.Candidates(nil, line)
					Expect(got).To(Equal(none()), "line %q", line)
					Expect(withheld).To(Equal(map[string]int{key: 1}), "line %q", line)
				}
			},
			Entry("a quoted local part", "\"Ana Smith\"@example.com", "example.com"),
			Entry("a comment before the @", "ana.smith(work)@example.com", "example.com"),
			Entry("the @ in parentheses", "ana(@)example.com", "other"),
			Entry("the @ in square brackets", "ana[@]example.com", "other"),
			Entry("the @ in angle brackets", "ana<@>example.com", "other"),
			Entry("the @ in double quotes", "ana\"@\"example.com", "other"),
			Entry("the local part in angle brackets", "<ana>@example.com", "example.com"),
			Entry("a colon before the @", "ana:@example.com", "example.com"),
			Entry("a comma before the @", "ana,@example.com", "example.com"),
			Entry("spaces around the @", "ana @ example.com", "other"),
		)

		It("withholds a quoted local part in an Assisted-by trailer", func() {
			msg := "rgw: fix\n\nAssisted-by: Claude, questions to \"Ana Smith\"@example.com\n"

			got, withheld := extract.Candidates([]string{msg}, "")

			Expect(got).To(Equal(none()))
			Expect(withheld).To(Equal(map[string]int{"example.com": 1}))
		})

		DescribeTable("keeps a tool's address in a matched pair of marks, or with closing punctuation",
			func(address string) {
				line := "Co-authored-by: Claude " + address
				Expect(extract.Candidates(nil, line)).To(Equal(description(line)), "line %q", line)
			},
			Entry("asterisks", "*noreply@anthropic.com*"),
			Entry("underscores", "_noreply@anthropic.com_"),
			Entry("backticks", "`noreply@anthropic.com`"),
			Entry("apostrophes", "'noreply@anthropic.com'"),
			Entry("braces", "{noreply@anthropic.com}"),
			Entry("bars", "|noreply@anthropic.com|"),
			Entry("tildes", "~noreply@anthropic.com~"),
			Entry("two nested pairs", "*_noreply@anthropic.com_*"),
			Entry("two other nested pairs", "`{noreply@anthropic.com}`"),
			Entry("a full stop", "noreply@anthropic.com."),
			Entry("an exclamation mark", "noreply@anthropic.com!"),
			Entry("a question mark", "noreply@anthropic.com?"),
		)

		DescribeTable("withholds a tool's address with a mark that is not part of a matched pair",
			func(address, key string) {
				line := "drafted with Claude, " + address
				got, withheld := extract.Candidates(nil, line)
				Expect(got).To(Equal(none()), "line %q", line)
				Expect(withheld).To(Equal(map[string]int{key: 1}), "line %q", line)
			},
			Entry("a leading asterisk", "*noreply@anthropic.com", "anthropic.com"),
			Entry("a leading underscore", "_bob@ibm.com", "ibm.com"),
			Entry("a leading backtick", "`noreply@anthropic.com", "anthropic.com"),
			Entry("a leading apostrophe", "'noreply@anthropic.com", "anthropic.com"),
			Entry("a leading brace", "{noreply@anthropic.com", "anthropic.com"),
			Entry("a leading bar", "|noreply@anthropic.com", "anthropic.com"),
			Entry("a leading tilde", "~bob@ibm.com", "ibm.com"),
			Entry("a leading full stop", ".bob@ibm.com", "ibm.com"),
			Entry("a leading exclamation mark", "!noreply@anthropic.com", "anthropic.com"),
			Entry("a leading question mark", "?noreply@anthropic.com", "anthropic.com"),
			Entry("text after an underscore", "bob@ibm.com_x", "other"),
			Entry("text before a full stop", "x.bob@ibm.com", "ibm.com"),
			Entry("pairs that do not match", "*noreply@anthropic.com_", "other"),
		)
	})

	It("finds trailers above a backport's cherry-pick line and Conflicts paragraph", func() {
		msg := "osd: fix a leak\n\n" +
			"Free the buffer on the error path.\n\n" +
			"Resolves: #12345\n" +
			"Assisted-by: Claude Code\n" +
			"Signed-off-by: Jane Roe <jane@example.com>\n" +
			"(cherry picked from commit 0123456789abcdef0123456789abcdef01234567)\n\n" +
			"Conflicts:\n" +
			"\tsrc/osd/PrimaryLogPG.cc\n" +
			"\t- kept the squid include order\n"

		Expect(extract.Candidates([]string{msg}, "")).To(Equal(trailer("Assisted-by: Claude Code")))
	})

	It("de-duplicates each list in order of first appearance across commits", func() {
		msgs := []string{
			"a: one\n\nAssisted-by: Gemini\nAssisted-by: Claude Code\n",
			"a: two\n\nAddress Copilot review comments\n\nAssisted-by: Claude Code\n",
			"a: three\n\nAddress Copilot review comments\nAssisted-by: Gemini\nAssisted-by: LLM\n",
		}
		body := "Generated with Claude Code\nsome text\nGenerated with Claude Code\n"

		Expect(extract.Candidates(msgs, body)).To(Equal(record.Disclosure{
			Trailers:    []string{"Assisted-by: Gemini", "Assisted-by: Claude Code", "Assisted-by: LLM"},
			Description: []string{"Generated with Claude Code"},
			CommitProse: []string{"Address Copilot review comments"},
		}))
	})

	It("cuts a candidate at 200 characters, counting characters rather than bytes", func() {
		long := "Assisted by Claude: " + strings.Repeat("é", 300)

		got, withheld := extract.Candidates(nil, long)

		Expect(withheld).To(BeNil())
		Expect(got.Description).To(HaveLen(1))
		Expect([]rune(got.Description[0])).To(HaveLen(200))
		Expect(got.Description[0]).To(HavePrefix("Assisted by Claude: éé"))
	})

	It("has no candidates, and empty lists rather than null, for text with none", func() {
		Expect(extract.Candidates([]string{"rgw: fix\n\nSigned-off-by: Jane Roe <jane@example.com>"}, "")).To(Equal(none()))
	})
})

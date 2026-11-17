package tables_test

import (
	"maps"
	"os"
	"path/filepath"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/jhoblitt/rook-dev-stats/internal/tables"
)

const validTools = `
trailer_keys: [Assisted-By, claude-session]
phrases:
  - 'generated with'
families:
  - id: claude
    name: Claude
    patterns: ['claude']
  - id: unspecified
    name: Unspecified
    patterns: ['\bllm\b', 'claude code']
ignore:
  - line: 'Co-authored-by: Claude Dupont <c@example.com>'
    why: a person named Claude
`

const validBots = `
accounts:
  - login: Jenkins-Rook
    why: posts CI results as a user
`

const validCommands = `
commands:
  - id: mergify-rebase
    name: '@mergifyio rebase'
    pattern: '@mergifyio rebase'
  - id: mergify-other
    name: '@mergifyio, another request'
    pattern: '@mergifyio .+'
  - id: ok-to-test
    name: ok to test
    pattern: 'OK To Test'
`

const validLabels = `
components:
  - id: object
    name: Object
    labels: [ceph-rgw, 'object-*']
  - id: filesystem
    name: File system
    labels: [filesystem]
  - id: build
    name: Build
    labels: ['build*']
process: [do-not-merge, 'debug-*-mirroring']
other: [DNM, 'what?', '[wip]', 'a\b']
`

const validKinds = `
kinds:
  - {id: bugfix, name: Bug fix}
  - {id: feature, name: Feature}
labels: {bug-fix: bugfix}
issue_labels: {bug: bugfix, feature: feature}
order: [labels, issues]
`

// writeTables writes a valid set of tables into a new directory, with any
// file replaced by its entry in override.
func writeTables(override map[string]string) string {
	GinkgoHelper()
	dir := GinkgoT().TempDir()
	files := map[string]string{
		tables.ToolsFile:    validTools,
		tables.BotsFile:     validBots,
		tables.CommandsFile: validCommands,
		tables.LabelsFile:   validLabels,
		tables.KindsFile:    validKinds,
	}
	maps.Copy(files, override)
	for name, content := range files {
		Expect(os.WriteFile(filepath.Join(dir, name), []byte(content), 0o600)).To(Succeed())
	}
	return dir
}

func load(override map[string]string) *tables.Tables {
	GinkgoHelper()
	t, err := tables.Load(writeTables(override))
	Expect(err).NotTo(HaveOccurred())
	return t
}

var _ = Describe("Load", func() {
	It("loads a valid set of tables", func() {
		t := load(nil)

		Expect(t.Tools.TrailerKeys).To(Equal([]string{"Assisted-By", "claude-session"}))
		Expect(t.Tools.Families).To(HaveLen(2))
		Expect(t.Bots.Accounts).To(ConsistOf(HaveField("Login", "Jenkins-Rook")))
		Expect(t.Commands.List).To(HaveLen(3))
		Expect(t.Labels.Components).To(HaveLen(3))
		Expect(t.Kinds.List).To(Equal([]tables.Kind{{ID: "bugfix", Name: "Bug fix"}, {ID: "feature", Name: "Feature"}}))
		Expect(t.Kinds.Labels).To(Equal(map[string]string{"bug-fix": "bugfix"}))
		Expect(t.Kinds.IssueLabels).To(Equal(map[string]string{"bug": "bugfix", "feature": "feature"}))
		Expect(t.Kinds.Order).To(Equal([]string{tables.SourceLabels, tables.SourceIssues}))
	})

	It("loads the committed seed tables", func() {
		t, err := tables.Load(filepath.Join("..", "..", "data"))
		Expect(err).NotTo(HaveOccurred())
		Expect(t.Kinds.List).NotTo(BeEmpty())
	})

	It("takes an empty file for an empty table", func() {
		t := load(map[string]string{tables.BotsFile: ""})
		Expect(t.Bots.Accounts).To(BeEmpty())
		Expect(t.Bots.Listed("Jenkins-Rook")).To(BeFalse())
	})

	It("fails on a missing table, naming it", func() {
		dir := writeTables(nil)
		Expect(os.Remove(filepath.Join(dir, tables.KindsFile))).To(Succeed())

		_, err := tables.Load(dir)
		Expect(err).To(MatchError(ContainSubstring(filepath.Join(dir, tables.KindsFile))))
	})

	It("fails on a table that does not parse, naming it", func() {
		dir := writeTables(map[string]string{tables.ToolsFile: "phrases: [unclosed\n"})

		_, err := tables.Load(dir)
		Expect(err).To(MatchError(ContainSubstring(filepath.Join(dir, tables.ToolsFile) + ": yaml:")))
	})

	It("fails on an unknown key, naming the file and the key", func() {
		dir := writeTables(map[string]string{tables.ToolsFile: "trailer_kyes: [assisted-by]\n"})

		_, err := tables.Load(dir)
		Expect(err).To(MatchError(And(
			ContainSubstring(filepath.Join(dir, tables.ToolsFile)),
			ContainSubstring("field trailer_kyes not found"),
		)))
	})

	It("lists every problem of every table at once", func() {
		dir := writeTables(map[string]string{
			tables.ToolsFile:    "phrases: ['(a', '(b']\n",
			tables.CommandsFile: "commands:\n  - {id: x, name: x, pattern: '(c'}\n",
			tables.LabelsFile:   "nonsense: true\ncomponents:\n  - {id: object, name: Object}\n",
		})

		_, err := tables.Load(dir)
		Expect(err).To(MatchError(And(
			ContainSubstring(`phrases: "(a" is not a valid regexp`),
			ContainSubstring(`phrases: "(b" is not a valid regexp`),
			ContainSubstring(`commands: "x": pattern "(c" is not a valid regexp`),
			ContainSubstring("field nonsense not found"),
			ContainSubstring(`components: "object" has no labels`),
		)))
	})

	DescribeTable("rejects an invalid entry, naming the file and the value",
		func(file, content, want string) {
			dir := writeTables(map[string]string{file: content})

			_, err := tables.Load(dir)
			Expect(err).To(MatchError(ContainSubstring(filepath.Join(dir, file) + ": " + want)))
		},
		Entry("an empty trailer key", tables.ToolsFile,
			"trailer_keys: [assisted-by, '']\n",
			"trailer_keys: entry 2 is empty"),
		Entry("an invalid phrase", tables.ToolsFile,
			"phrases: ['assisted (by']\n",
			`phrases: "assisted (by" is not a valid regexp`),
		Entry("an invalid family pattern", tables.ToolsFile,
			"families:\n  - {id: claude, name: Claude, patterns: ['[claude']}\n",
			`families: "claude": pattern "[claude" is not a valid regexp`),
		Entry("a family without patterns", tables.ToolsFile,
			"families:\n  - {id: claude, name: Claude}\n",
			`families: "claude" has no patterns`),
		Entry("a family without a name", tables.ToolsFile,
			"families:\n  - {id: claude, patterns: [claude]}\n",
			`families: "claude" has no name`),
		Entry("a family without an id", tables.ToolsFile,
			"families:\n  - {name: Claude, patterns: [claude]}\n",
			"families: entry 1 has no id"),
		Entry("a duplicate family id", tables.ToolsFile,
			"families:\n  - {id: claude, name: A, patterns: [a]}\n  - {id: claude, name: B, patterns: [b]}\n",
			`families: id "claude" appears twice`),
		Entry("an ignore entry without a line", tables.ToolsFile,
			"ignore:\n  - why: not a disclosure\n",
			"ignore: entry 1 has no line"),
		Entry("an ignore entry without a why", tables.ToolsFile,
			"ignore:\n  - line: 'GPT partition'\n",
			`ignore: "GPT partition" has no why`),
		Entry("a bot account without a login", tables.BotsFile,
			"accounts:\n  - why: posts test results\n",
			"accounts: entry 1 has no login"),
		Entry("a bot account without a why", tables.BotsFile,
			"accounts:\n  - login: ci-bot\n",
			`accounts: "ci-bot" has no why`),
		Entry("a bot account listed twice in different case", tables.BotsFile,
			"accounts:\n  - {login: ci-bot, why: a}\n  - {login: CI-Bot, why: b}\n",
			`accounts: login "CI-Bot" appears twice`),
		Entry("an invalid command pattern", tables.CommandsFile,
			"commands:\n  - {id: retest, name: retest, pattern: 'retest (this'}\n",
			`commands: "retest": pattern "retest (this" is not a valid regexp`),
		Entry("a command without an id", tables.CommandsFile,
			"commands:\n  - {name: retest, pattern: retest}\n",
			"commands: entry 1 has no id"),
		Entry("a command without a name", tables.CommandsFile,
			"commands:\n  - {id: retest, pattern: retest}\n",
			`commands: "retest" has no name`),
		Entry("a command without a pattern", tables.CommandsFile,
			"commands:\n  - {id: retest, name: retest}\n",
			`commands: "retest" has no pattern`),
		Entry("a duplicate command id", tables.CommandsFile,
			"commands:\n  - {id: retest, name: a, pattern: a}\n  - {id: retest, name: b, pattern: b}\n",
			`commands: id "retest" appears twice`),
		Entry("a duplicate component id", tables.LabelsFile,
			"components:\n  - {id: object, name: A, labels: [a]}\n  - {id: object, name: B, labels: [b]}\n",
			`components: id "object" appears twice`),
		Entry("a component without labels", tables.LabelsFile,
			"components:\n  - {id: object, name: Object}\n",
			`components: "object" has no labels`),
		Entry("a component without an id", tables.LabelsFile,
			"components:\n  - {name: Object, labels: [ceph-rgw]}\n",
			"components: entry 1 has no id"),
		Entry("a component without a name", tables.LabelsFile,
			"components:\n  - {id: object, labels: [ceph-rgw]}\n",
			`components: "object" has no name`),
		Entry("a duplicate kind id", tables.KindsFile,
			"kinds:\n  - {id: bugfix, name: A}\n  - {id: bugfix, name: B}\n",
			`kinds: id "bugfix" appears twice`),
		Entry("the reserved kind id unknown", tables.KindsFile,
			"kinds:\n  - {id: unknown, name: Unknown}\n",
			`kinds: id "unknown" is reserved`),
		Entry("the reserved kind id all", tables.KindsFile,
			"kinds:\n  - {id: all, name: All}\n",
			`kinds: id "all" is reserved`),
		Entry("a kind without an id", tables.KindsFile,
			"kinds:\n  - {name: Bug fix}\n",
			"kinds: entry 1 has no id"),
		Entry("a kind without a name", tables.KindsFile,
			"kinds:\n  - {id: bugfix}\n",
			`kinds: "bugfix" has no name`),
		Entry("the Ceph checklist table", tables.KindsFile,
			"kinds: [{id: feature, name: Feature}]\nchecklist: {new_feature: feature}\n",
			"yaml: unmarshal errors:\n  line 2: field checklist not found"),
		Entry("the Ceph tracker table", tables.KindsFile,
			"kinds: [{id: bugfix, name: Bug fix}]\ntracker: {Bug: bugfix}\n",
			"yaml: unmarshal errors:\n  line 2: field tracker not found"),
		Entry("a kind label mapped to no kind", tables.KindsFile,
			"kinds: [{id: bugfix, name: Bug fix}]\nlabels: {bug-fix: bug}\n",
			`labels: "bug-fix" maps to "bug", which is not a kind`),
		Entry("an issue label mapped to no kind", tables.KindsFile,
			"kinds: [{id: bugfix, name: Bug fix}]\nissue_labels: {bug: bugfx}\n",
			`issue_labels: "bug" maps to "bugfx", which is not a kind`),
		Entry("an issue label mapped to parent", tables.KindsFile,
			"kinds: [{id: bugfix, name: Bug fix}]\nissue_labels: {bug: parent}\n",
			`issue_labels: "bug" maps to "parent", which is not a kind`),
		Entry("an unknown source in the order", tables.KindsFile,
			"order: [labels, title]\n",
			`order: "title" is not a source; the sources are labels and issues`),
		Entry("the tracker in the order", tables.KindsFile,
			"order: [tracker, labels]\n",
			`order: "tracker" is not a source`),
		Entry("the checklist in the order", tables.KindsFile,
			"order: [checklist, labels]\n",
			`order: "checklist" is not a source`),
		Entry("a source twice in the order", tables.KindsFile,
			"order: [labels, labels]\n",
			`order: "labels" appears twice`),
	)
})

var _ = Describe("Tools", func() {
	var t *tables.Tables

	BeforeEach(func() {
		t = load(nil)
	})

	It("knows trailer keys in any case", func() {
		Expect(t.Tools.TrailerKey("assisted-by")).To(BeTrue())
		Expect(t.Tools.TrailerKey("CLAUDE-SESSION")).To(BeTrue())
		Expect(t.Tools.TrailerKey("co-authored-by")).To(BeFalse())
	})

	It("matches a phrase anywhere in a line, in any case", func() {
		Expect(t.Tools.Phrase("🤖 Generated with [Claude Code](https://claude.com)")).To(BeTrue())
		Expect(t.Tools.Phrase("Address Claude review comments")).To(BeFalse())
	})

	It("gives the first family whose pattern matches", func() {
		Expect(t.Tools.Family("Assisted-by: Claude Code")).To(Equal("claude"))
		Expect(t.Tools.Family("Assisted-by: an LLM")).To(Equal("unspecified"))
		Expect(t.Tools.Family("Assisted-by: Gemini")).To(BeEmpty())
	})

	It("ignores a candidate only when the whole line is listed", func() {
		Expect(t.Tools.Ignored("Co-authored-by: Claude Dupont <c@example.com>")).To(BeTrue())
		Expect(t.Tools.Ignored("Co-authored-by: Claude Dupont")).To(BeFalse())
	})
})

var _ = Describe("Bots", func() {
	It("lists an account in any case", func() {
		t := load(nil)
		Expect(t.Bots.Listed("jenkins-rook")).To(BeTrue())
		Expect(t.Bots.Listed("alice")).To(BeFalse())
	})
})

var _ = Describe("Commands", func() {
	var t *tables.Tables

	BeforeEach(func() {
		t = load(nil)
	})

	DescribeTable("matches the whole lower-cased text, first command first",
		func(text, want string) {
			Expect(t.Commands.Match(text)).To(Equal(want))
		},
		Entry("an exact command", "@mergifyio rebase", "mergify-rebase"),
		Entry("a command in upper case", "@Mergifyio Rebase", "mergify-rebase"),
		Entry("a later, broader command", "@mergifyio backport release-1.18", "mergify-other"),
		Entry("command text inside a sentence", "please @mergifyio rebase", ""),
		Entry("command text with more after it", "@mergifyio rebase please", "mergify-other"),
		Entry("a pattern written with capitals", "ok to test", "ok-to-test"),
		Entry("no command", "LGTM", ""),
		Entry("no text", "", ""),
	)
})

var _ = Describe("Labels", func() {
	var t *tables.Tables

	BeforeEach(func() {
		t = load(nil)
	})

	It("gives the components whose label patterns match, in table order", func() {
		Expect(t.Labels.ComponentsOf([]string{"filesystem", "object-bucket-claims", "ceph-rgw", "do-not-merge"})).
			To(Equal([]string{"object", "filesystem"}))
		Expect(t.Labels.ComponentsOf([]string{"do-not-merge"})).To(BeEmpty())
	})

	DescribeTable("classifies a label through any of its lists",
		func(label string, want bool) {
			Expect(t.Labels.Classified(label)).To(Equal(want))
		},
		Entry("a component label", "ceph-rgw", true),
		Entry("a component pattern with a star", "object-bucket-claims", true),
		Entry("a process label", "do-not-merge", true),
		Entry("a process pattern with a star", "debug-multi-cluster-mirroring", true),
		Entry("an other label", "DNM", true),
		Entry("a star that crosses a slash", "build/ops", true),
		Entry("a star in the middle", "debug-ci-mirroring", true),
		Entry("a star in the middle, the rest not matching", "debug-mirroring-x", false),
		Entry("a literal question mark", "what?", true),
		Entry("a question mark is not a wildcard", "whatx", false),
		Entry("literal brackets", "[wip]", true),
		Entry("brackets are not a class", "w", false),
		Entry("a literal backslash", `a\b`, true),
		Entry("a backslash escapes nothing", "ab", false),
		Entry("a label no list names", "core", false),
	)
})

var _ = Describe("Kinds", func() {
	It("knows its kinds", func() {
		t := load(nil)
		Expect(t.Kinds.Has("bugfix")).To(BeTrue())
		Expect(t.Kinds.Has("parent")).To(BeFalse())
	})
})

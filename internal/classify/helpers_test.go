package classify_test

import (
	"os"
	"path/filepath"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/jhoblitt/rook-dev-stats/internal/record"
	"github.com/jhoblitt/rook-dev-stats/internal/tables"
)

var specTables = map[string]string{
	tables.ToolsFile: `
trailer_keys: [assisted-by]
phrases: ['generated with', 'assisted by']
families:
  - {id: cursor, name: Cursor, patterns: ['\bcursor\b']}
  - {id: claude, name: Claude, patterns: [claude]}
  - {id: gemini, name: Gemini, patterns: [gemini]}
  - {id: unspecified, name: Unspecified, patterns: ['\bllm\b']}
ignore:
  - {line: 'Co-authored-by: Claude Dupont <c@example.com>', why: a person named Claude}
  - {line: 'Assisted-by: nobody', why: a joke}
  - {line: 'Generated with care', why: not a tool}
  - {line: 'Made-with: Claude Dupont', why: a person named Claude}
  - {line: 'by Gemini, said nobody', why: a joke}
`,
	tables.BotsFile: `
accounts:
  - {login: CI-User, why: posts test results}
`,
	tables.CommandsFile: `
commands:
  - {id: mergify-rebase, name: '@mergifyio rebase', pattern: '@mergifyio rebase'}
  - {id: ok-to-test, name: ok to test, pattern: 'ok to test'}
`,
	tables.LabelsFile: `
components:
  - {id: object, name: Object, labels: [ceph-rgw, 'object-*']}
  - {id: filesystem, name: File system, labels: [filesystem]}
process: [do-not-merge]
other: [security]
`,
	tables.KindsFile: `
kinds:
  - {id: bugfix, name: Bug fix}
  - {id: feature, name: Feature}
  - {id: docs, name: Documentation}
  - {id: other, name: Other}
labels: {bug-fix: bugfix, feature: feature, dependencies: other}
issue_labels: {bug: bugfix, feature: feature, docs: docs}
order: [labels, issues]
`,
}

// loadTables loads specTables with any file replaced by its entry in
// override.
func loadTables(override map[string]string) *tables.Tables {
	GinkgoHelper()
	dir := GinkgoT().TempDir()
	for name, content := range specTables {
		if o, ok := override[name]; ok {
			content = o
		}
		Expect(os.WriteFile(filepath.Join(dir, name), []byte(content), 0o600)).To(Succeed())
	}
	t, err := tables.Load(dir)
	Expect(err).NotTo(HaveOccurred())
	return t
}

var opened = time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)

// pr is a minimal open pull request by alice to main.
func pr(number int) record.Record {
	return record.Record{
		Number:     number,
		Author:     record.Actor{Login: "alice"},
		Base:       "master",
		Created:    opened,
		State:      record.StateOpen,
		Labels:     []string{},
		Events:     []record.Event{},
		Reviews:    []record.Review{},
		Comments:   []record.Comment{},
		Disclosure: record.Disclosure{Trailers: []string{}, Description: []string{}, CommitProse: []string{}},
	}
}

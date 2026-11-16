// Package tables loads and validates the hand-edited YAML tables under
// data/: what counts as a bot account, a bot command, an LLM disclosure, a
// component and a kind of change. The tables hold judgments, not data, so
// they can change without a new fetch.
package tables

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"

	"go.yaml.in/yaml/v3"
)

// Table files under the data directory.
const (
	ToolsFile    = "tools.yaml"
	BotsFile     = "bots.yaml"
	CommandsFile = "commands.yaml"
	LabelsFile   = "labels.yaml"
	KindsFile    = "kinds.yaml"
)

// Tables is every table, loaded and validated.
type Tables struct {
	Tools    Tools
	Bots     Bots
	Commands Commands
	Labels   Labels
	Kinds    Kinds
}

// table is one file's content; validate compiles what it needs and returns
// every problem it finds.
type table interface {
	validate() []error
}

// Load reads and validates every table in dir. Its error lists every
// problem in every table, each naming its file; a key a table does not
// define is a problem, so a typo is not silently ignored.
func Load(dir string) (*Tables, error) {
	t := &Tables{}
	var errs []error
	for _, f := range []struct {
		name  string
		table table
	}{
		{ToolsFile, &t.Tools},
		{BotsFile, &t.Bots},
		{CommandsFile, &t.Commands},
		{LabelsFile, &t.Labels},
		{KindsFile, &t.Kinds},
	} {
		path := filepath.Join(dir, f.name)
		decoded, err := decode(path, f.table)
		if err != nil {
			errs = append(errs, err)
		}
		if !decoded {
			continue
		}
		for _, p := range f.table.validate() {
			errs = append(errs, fmt.Errorf("%s: %w", path, p))
		}
	}
	if err := errors.Join(errs...); err != nil {
		return nil, err
	}
	return t, nil
}

// decode decodes the table at path into v and reports whether v holds its
// content. A type error, an unknown key among them, still decodes
// everything else, which is worth validating too.
func decode(path string, v any) (bool, error) {
	b, err := os.ReadFile(path) //nolint:gosec // the data directory is the operator's to name
	if err != nil {
		return false, fmt.Errorf("reading table: %w", err)
	}
	dec := yaml.NewDecoder(bytes.NewReader(b))
	dec.KnownFields(true)
	err = dec.Decode(v)
	if te, ok := errors.AsType[*yaml.TypeError](err); ok {
		return true, fmt.Errorf("%s: %w", path, te)
	}
	if err != nil && !errors.Is(err, io.EOF) {
		return false, fmt.Errorf("%s: %w", path, err)
	}
	return true, nil
}

// compile compiles a pattern written in a table. The error carries the
// pattern as written, not the form it is compiled to.
func compile(prefix, pattern, suffix string) (*regexp.Regexp, error) {
	if _, err := regexp.Compile(pattern); err != nil {
		return nil, err
	}
	return regexp.MustCompile(prefix + pattern + suffix), nil
}

// ids reports the ids that appear more than once, under the list's name.
type ids struct {
	list string
	seen map[string]bool
}

func newIDs(list string) *ids {
	return &ids{list: list, seen: map[string]bool{}}
}

// add records id and returns a problem when it was seen before.
func (s *ids) add(id string) error {
	if s.seen[id] {
		return fmt.Errorf("%s: id %q appears twice", s.list, id)
	}
	s.seen[id] = true
	return nil
}

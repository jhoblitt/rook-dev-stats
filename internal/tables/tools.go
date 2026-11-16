package tables

import (
	"fmt"
	"regexp"
	"strings"
)

// Tools is tools.yaml: what makes a disclosure candidate count, and which
// tool family it names. Phrases and family patterns match anywhere in a
// line, in any case.
type Tools struct {
	// TrailerKeys are the trailer keys that disclose by themselves.
	TrailerKeys []string `yaml:"trailer_keys"`
	// Phrases are what a description or commit-prose line must match to
	// count: a tool's name alone is not a disclosure.
	Phrases  []string `yaml:"phrases"`
	Families []Family `yaml:"families"`
	// Ignore lists candidates judged not to be a disclosure.
	Ignore []Ignore `yaml:"ignore"`

	keys    map[string]bool
	phrases []*regexp.Regexp
	ignored map[string]bool
}

// Family is a tool family. A counted disclosure names the first family,
// in table order, one of whose patterns matches it.
type Family struct {
	ID       string   `yaml:"id"`
	Name     string   `yaml:"name"`
	Patterns []string `yaml:"patterns"`

	res []*regexp.Regexp
}

// Ignore is a candidate line, matched exactly, and why it is not a
// disclosure.
type Ignore struct {
	Line string `yaml:"line"`
	Why  string `yaml:"why"`
}

func (t *Tools) validate() []error {
	var errs []error
	t.keys = map[string]bool{}
	for i, k := range t.TrailerKeys {
		if k == "" {
			errs = append(errs, fmt.Errorf("trailer_keys: entry %d is empty", i+1))
		}
		t.keys[strings.ToLower(k)] = true
	}
	t.phrases = nil
	for _, p := range t.Phrases {
		re, err := compile("(?i)", p, "")
		if err != nil {
			errs = append(errs, fmt.Errorf("phrases: %q is not a valid regexp: %w", p, err))
			continue
		}
		t.phrases = append(t.phrases, re)
	}
	seen := newIDs("families")
	for i := range t.Families {
		f := &t.Families[i]
		if f.ID == "" {
			errs = append(errs, fmt.Errorf("families: entry %d has no id", i+1))
			continue
		}
		if err := seen.add(f.ID); err != nil {
			errs = append(errs, err)
		}
		if f.Name == "" {
			errs = append(errs, fmt.Errorf("families: %q has no name", f.ID))
		}
		if len(f.Patterns) == 0 {
			errs = append(errs, fmt.Errorf("families: %q has no patterns", f.ID))
		}
		f.res = nil
		for _, p := range f.Patterns {
			re, err := compile("(?i)", p, "")
			if err != nil {
				errs = append(errs, fmt.Errorf("families: %q: pattern %q is not a valid regexp: %w", f.ID, p, err))
				continue
			}
			f.res = append(f.res, re)
		}
	}
	t.ignored = map[string]bool{}
	for i, ig := range t.Ignore {
		switch {
		case ig.Line == "":
			errs = append(errs, fmt.Errorf("ignore: entry %d has no line", i+1))
		case ig.Why == "":
			errs = append(errs, fmt.Errorf("ignore: %q has no why", ig.Line))
		}
		t.ignored[ig.Line] = true
	}
	return errs
}

// TrailerKey reports whether key, in any case, is a disclosing trailer key.
func (t *Tools) TrailerKey(key string) bool {
	return t.keys[strings.ToLower(key)]
}

// Phrase reports whether line uses disclosure phrasing.
func (t *Tools) Phrase(line string) bool {
	for _, re := range t.phrases {
		if re.MatchString(line) {
			return true
		}
	}
	return false
}

// Family returns the id of the first family that matches text, or "" when
// none does.
func (t *Tools) Family(text string) string {
	for i := range t.Families {
		for _, re := range t.Families[i].res {
			if re.MatchString(text) {
				return t.Families[i].ID
			}
		}
	}
	return ""
}

// Ignored reports whether the candidate line is listed under ignore.
func (t *Tools) Ignored(line string) bool {
	return t.ignored[line]
}

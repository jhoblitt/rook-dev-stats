package tables

import (
	"fmt"
	"regexp"
	"strings"
)

// Commands is commands.yaml: the comments that only trigger automation.
type Commands struct {
	List []Command `yaml:"commands"`
}

// Command is a bot command. Its pattern must match a comment's whole
// lower-cased text; it is compiled case-insensitively, so a pattern
// written with capitals still matches.
type Command struct {
	ID      string `yaml:"id"`
	Name    string `yaml:"name"`
	Pattern string `yaml:"pattern"`

	re *regexp.Regexp
}

func (c *Commands) validate() []error {
	var errs []error
	seen := newIDs("commands")
	for i := range c.List {
		cmd := &c.List[i]
		if cmd.ID == "" {
			errs = append(errs, fmt.Errorf("commands: entry %d has no id", i+1))
			continue
		}
		if err := seen.add(cmd.ID); err != nil {
			errs = append(errs, err)
		}
		if cmd.Name == "" {
			errs = append(errs, fmt.Errorf("commands: %q has no name", cmd.ID))
		}
		if cmd.Pattern == "" {
			errs = append(errs, fmt.Errorf("commands: %q has no pattern", cmd.ID))
			continue
		}
		re, err := compile("(?i)^(?:", cmd.Pattern, ")$")
		if err != nil {
			errs = append(errs, fmt.Errorf("commands: %q: pattern %q is not a valid regexp: %w", cmd.ID, cmd.Pattern, err))
			continue
		}
		cmd.re = re
	}
	return errs
}

// Match returns the id of the first command whose pattern matches the
// whole of text, lower-cased, or "" when none does.
func (c *Commands) Match(text string) string {
	if text == "" {
		return ""
	}
	text = strings.ToLower(text)
	for i := range c.List {
		if c.List[i].re.MatchString(text) {
			return c.List[i].ID
		}
	}
	return ""
}

package tables

import (
	"fmt"
	"regexp"
	"strings"
)

// Labels is labels.yaml: which labels name a component, which a process
// state, and which neither. Each entry is a label pattern in which `*`
// matches any run of characters, `/` included, and every other character
// stands for itself.
type Labels struct {
	Components []Component `yaml:"components"`
	Process    []string    `yaml:"process"`
	Other      []string    `yaml:"other"`

	process []*regexp.Regexp
	other   []*regexp.Regexp
}

// Component is a part of Ceph and the labels that put a pull request in it.
type Component struct {
	ID     string   `yaml:"id"`
	Name   string   `yaml:"name"`
	Labels []string `yaml:"labels"`

	res []*regexp.Regexp
}

func (l *Labels) validate() []error {
	var errs []error
	seen := newIDs("components")
	for i := range l.Components {
		c := &l.Components[i]
		c.res = labelPatterns(c.Labels)
		if c.ID == "" {
			errs = append(errs, fmt.Errorf("components: entry %d has no id", i+1))
			continue
		}
		if err := seen.add(c.ID); err != nil {
			errs = append(errs, err)
		}
		if c.Name == "" {
			errs = append(errs, fmt.Errorf("components: %q has no name", c.ID))
		}
		if len(c.Labels) == 0 {
			errs = append(errs, fmt.Errorf("components: %q has no labels", c.ID))
		}
	}
	l.process = labelPatterns(l.Process)
	l.other = labelPatterns(l.Other)
	return errs
}

func labelPatterns(patterns []string) []*regexp.Regexp {
	res := make([]*regexp.Regexp, len(patterns))
	for i, p := range patterns {
		parts := strings.Split(p, "*")
		for j := range parts {
			parts[j] = regexp.QuoteMeta(parts[j])
		}
		res[i] = regexp.MustCompile(`^` + strings.Join(parts, `.*`) + `$`)
	}
	return res
}

func matchAny(res []*regexp.Regexp, label string) bool {
	for _, re := range res {
		if re.MatchString(label) {
			return true
		}
	}
	return false
}

// ComponentsOf returns the ids of the components any of labels puts a pull
// request in, in table order.
func (l *Labels) ComponentsOf(labels []string) []string {
	var ids []string
	for _, c := range l.Components {
		for _, label := range labels {
			if matchAny(c.res, label) {
				ids = append(ids, c.ID)
				break
			}
		}
	}
	return ids
}

// Classified reports whether a component, the process states or the other
// labels name label.
func (l *Labels) Classified(label string) bool {
	for _, c := range l.Components {
		if matchAny(c.res, label) {
			return true
		}
	}
	return matchAny(l.process, label) || matchAny(l.other, label)
}

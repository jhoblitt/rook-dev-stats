package tables

import (
	"fmt"
	"maps"
	"slices"
)

// The sources a kind can come from, as kinds.yaml's order names them.
const (
	SourceLabels = "labels"
	SourceIssues = "issues"
)

// sources are the sources order may name.
var sources = []string{SourceLabels, SourceIssues}

// reservedKinds are words the site uses beside the kind ids.
var reservedKinds = []string{"unknown", "all"}

// Kinds is kinds.yaml: the kinds of change, and what decides a pull
// request's kind.
type Kinds struct {
	// List is the kinds, in the order the site shows them.
	List []Kind `yaml:"kinds"`
	// Labels maps a pull request's label to a kind.
	Labels map[string]string `yaml:"labels"`
	// IssueLabels maps the label of an issue the pull request closes to a
	// kind.
	IssueLabels map[string]string `yaml:"issue_labels"`
	// Order is the sources to try, first to last.
	Order []string `yaml:"order"`
}

// Kind is a kind of change.
type Kind struct {
	ID   string `yaml:"id"`
	Name string `yaml:"name"`
}

func (k *Kinds) validate() []error {
	var errs []error
	seen := newIDs("kinds")
	for i, kind := range k.List {
		switch {
		case kind.ID == "":
			errs = append(errs, fmt.Errorf("kinds: entry %d has no id", i+1))
			continue
		case slices.Contains(reservedKinds, kind.ID):
			errs = append(errs, fmt.Errorf("kinds: id %q is reserved", kind.ID))
		}
		if err := seen.add(kind.ID); err != nil {
			errs = append(errs, err)
		}
		if kind.Name == "" {
			errs = append(errs, fmt.Errorf("kinds: %q has no name", kind.ID))
		}
	}
	errs = append(errs, k.mapsToKinds("labels", k.Labels)...)
	errs = append(errs, k.mapsToKinds("issue_labels", k.IssueLabels)...)
	var order []string
	for _, src := range k.Order {
		switch {
		case !slices.Contains(sources, src):
			errs = append(errs, fmt.Errorf("order: %q is not a source; the sources are labels and issues", src))
		case slices.Contains(order, src):
			errs = append(errs, fmt.Errorf("order: %q appears twice", src))
		}
		order = append(order, src)
	}
	return errs
}

func (k *Kinds) mapsToKinds(name string, m map[string]string) []error {
	var errs []error
	for _, from := range slices.Sorted(maps.Keys(m)) {
		if to := m[from]; !k.Has(to) {
			errs = append(errs, fmt.Errorf("%s: %q maps to %q, which is not a kind", name, from, to))
		}
	}
	return errs
}

// Has reports whether id is one of the kinds.
func (k *Kinds) Has(id string) bool {
	return slices.ContainsFunc(k.List, func(kind Kind) bool { return kind.ID == id })
}

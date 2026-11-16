package tables

import (
	"fmt"
	"maps"
	"slices"

	"github.com/jhoblitt/ceph-dev-stats/internal/record"
)

// Parent is what a ticket type maps to when the ticket stands for its
// parent's kind: a Backport ticket is a copy of the ticket it backports.
const Parent = "parent"

// The sources a kind can come from, as kinds.yaml's order names them.
const (
	SourceChecklist = "checklist"
	SourceTracker   = "tracker"
	SourceLabels    = "labels"
)

// reservedKinds are words the site uses beside the kind ids.
var reservedKinds = []string{"unknown", "all", Parent}

var checklistBoxes = []string{
	record.CheckReferencesTicket, record.CheckVeryRecentBug, record.CheckNewFeature,
	record.CheckDocUpdate, record.CheckCodeCleanup,
}

// Kinds is kinds.yaml: the kinds of change, and what decides a pull
// request's kind.
type Kinds struct {
	// List is the kinds, in the order the site shows them.
	List []Kind `yaml:"kinds"`
	// Checklist maps a ticked box of the PR template to a kind.
	Checklist map[string]string `yaml:"checklist"`
	// Tracker maps a tracker ticket type to a kind, or to Parent.
	Tracker map[string]string `yaml:"tracker"`
	// Labels maps a label to a kind.
	Labels map[string]string `yaml:"labels"`
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
	for _, box := range slices.Sorted(maps.Keys(k.Checklist)) {
		if !slices.Contains(checklistBoxes, box) {
			errs = append(errs, fmt.Errorf("checklist: %q is not a box of the template", box))
		}
	}
	errs = append(errs, k.mapsToKinds(SourceChecklist, k.Checklist, false)...)
	errs = append(errs, k.mapsToKinds(SourceTracker, k.Tracker, true)...)
	errs = append(errs, k.mapsToKinds(SourceLabels, k.Labels, false)...)
	var order []string
	for _, src := range k.Order {
		switch {
		case src != SourceChecklist && src != SourceTracker && src != SourceLabels:
			errs = append(errs, fmt.Errorf("order: %q is not a source; the sources are checklist, tracker and labels", src))
		case slices.Contains(order, src):
			errs = append(errs, fmt.Errorf("order: %q appears twice", src))
		}
		order = append(order, src)
	}
	return errs
}

func (k *Kinds) mapsToKinds(name string, m map[string]string, parentOK bool) []error {
	var errs []error
	for _, from := range slices.Sorted(maps.Keys(m)) {
		to := m[from]
		if !k.Has(to) && (to != Parent || !parentOK) {
			errs = append(errs, fmt.Errorf("%s: %q maps to %q, which is not a kind", name, from, to))
		}
	}
	return errs
}

// Has reports whether id is one of the kinds.
func (k *Kinds) Has(id string) bool {
	return slices.ContainsFunc(k.List, func(kind Kind) bool { return kind.ID == id })
}

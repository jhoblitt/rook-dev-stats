package record

// The boxes of the pull request template's Tracker section, as
// KindHints.Checklist names them.
const (
	CheckReferencesTicket = "references_ticket"
	CheckVeryRecentBug    = "very_recent_bug"
	CheckNewFeature       = "new_feature"
	CheckDocUpdate        = "doc_update"
	CheckCodeCleanup      = "code_cleanup"
)

// KindHints is what a pull request's kind can be decided from, not the
// decision. An empty hint is left out.
type KindHints struct {
	// Checklist is the ticked boxes of the Tracker section, in the order of
	// the Check constants.
	Checklist []string `json:"checklist,omitempty"`
	// Tickets is the tracker.ceph.com issues referenced, first by the
	// commits' Fixes: trailers in commit order, then by the description.
	Tickets []int `json:"tickets,omitempty"`
	// BackportOf is the pull request the description says this one is a
	// backport of.
	BackportOf int `json:"backport_of,omitempty"`
}

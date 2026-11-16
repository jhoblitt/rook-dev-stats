package record

// KindHints is what a pull request's kind can be decided from, not the
// decision. An empty hint is left out.
type KindHints struct {
	// Issues is the issues GitHub links as closed by the pull request, in
	// GitHub's order.
	Issues []Issue `json:"issues,omitempty"`
	// BackportOf is the pull request the description or title says this
	// one is a backport of.
	BackportOf int `json:"backport_of,omitempty"`
}

// Issue is an issue a pull request closes.
type Issue struct {
	Number int `json:"number"`
	// Repository is the issue's repository as owner/name, which need not
	// be the pull request's.
	Repository string `json:"repository,omitempty"`
	// Labels is the issue's labels, sorted.
	Labels []string `json:"labels,omitempty"`
}

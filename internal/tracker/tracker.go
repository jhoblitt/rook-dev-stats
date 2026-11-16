// Package tracker reads the type of each tracker.ceph.com ticket the
// records reference into data/tickets.json. It asks the tracker, a public
// Redmine, anonymously, one request at a time, at most one a second, in
// batches, and only for the tickets the file does not hold yet, or, when
// asked to refresh, holds with an empty type.
package tracker

// File is the ticket file's name under the data directory.
const File = "tickets.json"

// DefaultURL is tracker.ceph.com.
const DefaultURL = "https://tracker.ceph.com"

// BatchSize is the most tickets one request asks for: Redmine's largest
// page.
const BatchSize = 100

// TypeBackport is the tracker's name for a backport ticket, which is copied
// from the ticket it backports.
const TypeBackport = "Backport"

// Ticket is what data/tickets.json holds of one ticket.
type Ticket struct {
	// Type is the tracker's name for the ticket's type, stored as given. It
	// is empty when the tracker would not show the ticket.
	Type string `json:"type"`
	// Parent is the ticket a Backport ticket was copied from, and zero for
	// any other ticket.
	Parent int `json:"parent,omitempty"`
}

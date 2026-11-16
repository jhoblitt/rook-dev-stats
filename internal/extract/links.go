package extract

import (
	"regexp"
	"strconv"

	"github.com/jhoblitt/ceph-dev-stats/internal/fetch"
)

var eventAddress = regexp.MustCompile(`#event-(\d+)$`)

// eventID is the id at the end of an event's GitHub address, and false for
// an address of any other shape.
func eventID(url string) (int64, bool) {
	m := eventAddress.FindStringSubmatch(url)
	if m == nil {
		return 0, false
	}
	id, err := strconv.ParseInt(m[1], 10, 64)
	if err != nil {
		return 0, false
	}
	return id, true
}

// eventSHA is the commit an event's record names: a merge's merge commit,
// or the head a force-push left.
func eventSHA(ev fetch.Event) string {
	var c *fetch.CommitRef
	switch ev.Typename {
	case "MergedEvent":
		c = ev.Commit
	case "HeadRefForcePushedEvent":
		c = ev.AfterCommit
	}
	if c == nil {
		return ""
	}
	return c.OID
}

// oddAddresses lists the addresses of e's events that no event id can be
// read from. An event without an address is not one: a reopening has none,
// and neither has any event of an entry cached before entries held them.
func oddAddresses(e fetch.Entry) []string {
	var odd []string
	for _, ev := range e.TimelineItems {
		if _, ok := eventID(ev.URL); ev.URL != "" && !ok {
			odd = append(odd, ev.URL)
		}
	}
	return odd
}

package tracker

import (
	"context"
	"fmt"
	"log/slog"
	"slices"

	"github.com/jhoblitt/ceph-dev-stats/internal/record"
)

// Config is one run's settings.
type Config struct {
	// DataDir holds the committed prs/ and tickets.json.
	DataDir string
	// Refresh asks again for the saved tickets whose type is empty.
	Refresh bool
	// Logger receives progress; slog.Default() when nil.
	Logger *slog.Logger
}

// Run asks c for every ticket the records in cfg.DataDir reference that
// tickets.json does not hold yet, in batches of BatchSize in ascending
// order, and saves the file after each batch, so a run that stops keeps
// what it has. A Backport ticket's parent is asked for too, in a following
// batch, and so is a saved Backport ticket's parent that is not saved.
func Run(ctx context.Context, c *Client, cfg Config) error {
	log := cfg.Logger
	if log == nil {
		log = slog.Default()
	}
	recs, err := record.ReadRecords(cfg.DataDir)
	if err != nil {
		return err
	}
	saved, err := Read(cfg.DataDir)
	if err != nil {
		return err
	}
	queue := unsaved(recs, saved, cfg.Refresh)
	queued := map[int]bool{}
	for _, id := range queue {
		queued[id] = true
	}

	requests := 0
	for len(queue) > 0 {
		batch := queue[:min(BatchSize, len(queue))]
		queue = queue[len(batch):]
		got, err := c.Tickets(ctx, batch)
		if err != nil {
			return fmt.Errorf("asking the tracker for %d tickets from %d: %w", len(batch), batch[0], err)
		}
		requests++
		var parents []int
		for id, t := range got {
			saved[id] = t
			if p := t.Parent; p != 0 && !queued[p] {
				if _, ok := saved[p]; !ok {
					queued[p] = true
					parents = append(parents, p)
				}
			}
		}
		slices.Sort(parents)
		queue = append(queue, parents...)
		if _, err := Write(cfg.DataDir, saved); err != nil {
			return err
		}
		log.InfoContext(ctx, "tracker batch saved",
			slog.Int("tickets", len(batch)),
			slog.Int("first", batch[0]),
			slog.Int("remaining", len(queue)))
	}

	unknown := 0
	for _, t := range saved {
		if t.Type == "" {
			unknown++
		}
	}
	log.InfoContext(ctx, "tickets finished",
		slog.Int("requests", requests),
		slog.Int("saved", len(saved)),
		slog.Int("unknown", unknown))
	return nil
}

// unsaved is the tickets to ask for, ascending: those the records
// reference and the saved Backport tickets' parents, when not saved, and
// with refresh the saved tickets whose type is empty.
func unsaved(recs []record.Record, saved map[int]Ticket, refresh bool) []int {
	want := map[int]bool{}
	for i := range recs {
		if h := recs[i].KindHints; h != nil {
			for _, id := range h.Tickets {
				want[id] = true
			}
		}
	}
	for id, t := range saved {
		if t.Parent != 0 {
			want[t.Parent] = true
		}
		if refresh && t.Type == "" {
			want[id] = true
		}
	}
	var out []int
	for id := range want {
		if t, ok := saved[id]; !ok || (refresh && t.Type == "") {
			out = append(out, id)
		}
	}
	slices.Sort(out)
	return out
}

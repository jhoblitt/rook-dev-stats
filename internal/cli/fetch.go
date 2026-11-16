package cli

import (
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"

	"github.com/jhoblitt/ceph-dev-stats/internal/fetch"
	"github.com/jhoblitt/ceph-dev-stats/internal/ghapi"
)

func newFetchCmd(v *viper.Viper) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "fetch",
		Short: "Walk ceph/ceph pull requests from GitHub into the local raw cache",
		Long: `Walk ceph/ceph pull requests from GitHub into the local raw cache.

The GitHub token is read from CEPHSTATS_GITHUB_TOKEN, GH_TOKEN or
GITHUB_TOKEN, in that order.

A --since later than the default skips pull requests the next default walk
would otherwise trust as walked, so it leaves the cache's meta.json, the
coverage mark, as it was.

A --refetch walk that stops early keeps the entries it replaced but does
not resume: run again with --refetch, it downloads every pull request in
its range again; without it, only those updated since they were cached.`,
		Args: cobra.NoArgs,
		PreRunE: func(*cobra.Command, []string) error {
			if v.GetBool("full") && v.GetString("since") != "" {
				return errors.New("--since and --full are mutually exclusive")
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, _ []string) error {
			token, err := ghapi.Token(os.Getenv)
			if err != nil {
				return err
			}
			cfg, err := fetchSince(v)
			if err != nil {
				return err
			}
			cfg.CacheDir = v.GetString("cache-dir")
			cfg.Refetch = v.GetBool("refetch")
			client, err := ghapi.NewClient(v.GetString("api-url"), token)
			if err != nil {
				return err
			}
			return fetch.Run(cmd.Context(), client, cfg)
		},
	}
	f := cmd.Flags()
	f.String("since", "", "walk back to pull requests updated at this RFC 3339 time; default a day before the data directory's fetched_through, or, with no meta.json there, the window start, when ceph/ceph was created (CEPHSTATS_SINCE)")
	f.Bool("full", false, "walk back to the window start, when ceph/ceph was created, listing every pull request (CEPHSTATS_FULL)")
	f.Bool("refetch", false, "fetch again each pull request the walk lists, every one updated since --since or its default (the window start with --full) and every open one, though cached at the same updatedAt, re-downloading each of them (CEPHSTATS_REFETCH)")
	f.String("cache-dir", ".cache", "raw cache directory (CEPHSTATS_CACHE_DIR)")
	f.String("data", "data", "committed data directory, read for meta.json (CEPHSTATS_DATA)")
	f.String("api-url", ghapi.DefaultEndpoint, "GitHub GraphQL endpoint (CEPHSTATS_API_URL)")
	return cmd
}

// fetchSince fills a walk's Since, SinceIsDefault and DefaultSince from
// --since and --full. A --since is compared with the default so that a
// narrower walk does not move the coverage mark; --full covers every
// default and needs no comparison.
func fetchSince(v *viper.Viper) (fetch.Config, error) {
	if v.GetBool("full") {
		return fetch.Config{Since: fetch.WindowStart}, nil
	}
	var since time.Time
	if s := v.GetString("since"); s != "" {
		t, err := time.Parse(time.RFC3339, s)
		if err != nil {
			return fetch.Config{}, fmt.Errorf("parsing --since: %w", err)
		}
		since = t.UTC()
	}
	def, err := fetch.DefaultSince(v.GetString("data"))
	if err != nil {
		return fetch.Config{}, err
	}
	if since.IsZero() {
		return fetch.Config{Since: def, SinceIsDefault: true, DefaultSince: def}, nil
	}
	return fetch.Config{Since: since, DefaultSince: def}, nil
}

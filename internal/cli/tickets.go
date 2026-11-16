package cli

import (
	"github.com/spf13/cobra"
	"github.com/spf13/viper"

	"github.com/jhoblitt/rook-dev-stats/internal/tracker"
)

func newTicketsCmd(v *viper.Viper) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "tickets",
		Short: "Read the type of each tracker ticket the records reference",
		Long: `Read the type of each tracker.ceph.com ticket the records reference into
data/tickets.json.

Only tickets not yet in the file are asked for, up to 100 to a request,
one request a second, anonymously. A ticket the tracker does not show is
saved with an empty type; --refresh asks for those again. The file is
saved after each request, so an interrupted run keeps what it has.`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			client, err := tracker.NewClient(v.GetString("tracker-url"))
			if err != nil {
				return err
			}
			return tracker.Run(cmd.Context(), client, tracker.Config{
				DataDir: v.GetString("data"),
				Refresh: v.GetBool("refresh"),
			})
		},
	}
	f := cmd.Flags()
	f.String("data", "data", "committed data directory (ROOKSTATS_DATA)")
	f.String("tracker-url", tracker.DefaultURL, "tracker base URL (ROOKSTATS_TRACKER_URL)")
	f.Bool("refresh", false, "ask again for the saved tickets whose type is empty (ROOKSTATS_REFRESH)")
	return cmd
}

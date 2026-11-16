package cli

import (
	"errors"
	"fmt"
	"io/fs"
	"log/slog"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"

	"github.com/jhoblitt/rook-dev-stats/internal/record"
	"github.com/jhoblitt/rook-dev-stats/internal/rollup"
	"github.com/jhoblitt/rook-dev-stats/internal/tables"
)

func newRollupCmd(v *viper.Viper) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "rollup",
		Short: "Write the statistics site's data from the records and the tables",
		Long: `Classify the records with the hand-edited tables, and
write the statistics site's data: meta.json; for each year, the columns
of the pull requests that finished in it, their events, and their table
of titles and links, with the pull requests still open filed under the
year of fetched_through; and index.json, the year each pull request is
filed under, by number.

Only the files whose content changes are rewritten, and a file of a year
that no longer has a pull request is removed. Other files in the output
directory are left alone. meta.json is optional, and so are records:
with none, the data is an empty dataset the site can load. Rollup does
not run check: tables that do not yet classify every label still roll
up.`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			in, err := rollupInput(v.GetString("data"))
			if err != nil {
				return err
			}
			files, err := rollup.Build(in)
			if err != nil {
				return err
			}
			res, err := rollup.Write(v.GetString("out"), files)
			if err != nil {
				return err
			}
			slog.InfoContext(cmd.Context(), "rollup finished",
				slog.Int("records", len(in.Records)),
				slog.Int("files", len(files)),
				slog.Int("written", len(res.Written)),
				slog.Int("removed", len(res.Removed)))
			return nil
		},
	}
	f := cmd.Flags()
	f.String("data", "data", "committed data directory (ROOKSTATS_DATA)")
	f.String("out", "site/public/data", "directory the site's data is written to (ROOKSTATS_OUT)")
	return cmd
}

func rollupInput(dir string) (rollup.Input, error) {
	t, err := tables.Load(dir)
	if err != nil {
		return rollup.Input{}, fmt.Errorf("loading the tables:\n%w", err)
	}
	recs, err := record.ReadRecords(dir)
	if err != nil {
		return rollup.Input{}, err
	}
	in := rollup.Input{Tables: t, Records: recs}
	switch m, err := record.ReadMeta(dir); {
	case err == nil:
		in.Meta = &m
	case !errors.Is(err, fs.ErrNotExist):
		return rollup.Input{}, err
	}
	return in, nil
}

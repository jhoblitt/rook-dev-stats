package cli

import (
	"errors"
	"fmt"
	"io"
	"io/fs"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"

	"github.com/jhoblitt/rook-dev-stats/internal/classify"
	"github.com/jhoblitt/rook-dev-stats/internal/record"
	"github.com/jhoblitt/rook-dev-stats/internal/tables"
)

func newCheckCmd(v *viper.Viper) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "check",
		Short: "Validate the hand-edited tables against the records",
		Long: `Validate the hand-edited tables in the data directory, then classify the
records with them.

It fails, listing every problem at once, on a table that does not parse,
holds an unknown key, an invalid regexp, or a duplicate id; on a
tools.yaml with no unspecified family; on a trailer or label no table
accounts for; on a counted disclosure that names
no tool family; and on record
counts more than 0.5% from GitHub's counts in meta.json. A candidate line
can name a person, so a problem with one names its trailer key, how many
lines and which pull requests, and never quotes the line.

With --report it also prints, without failing, how many pull requests
deleted accounts opened, how many of them are named from their commits and
by how many names (never a name), the candidate lines behind
those problems, neighboring candidates that match a disclosure phrase only
when joined (never counted; a real one needs a phrase of its own), and
what the tables do not yet match, most frequent first, for whoever edits
them. The reports quote lines and rank accounts by comment count, so they
are printed only when asked for and never in CI. Records and meta.json
are each optional.`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			in, err := checkInput(v.GetString("data"))
			if err != nil {
				return err
			}
			in.Top = v.GetInt("top")
			out := io.Discard
			if v.GetBool("report") {
				out = cmd.OutOrStdout()
			}
			if err := classify.Check(in, out); err != nil {
				return fmt.Errorf("check failed:\n%w", err)
			}
			return nil
		},
	}
	f := cmd.Flags()
	f.String("data", "data", "committed data directory (ROOKSTATS_DATA)")
	f.Bool("report", false, "print the reports for whoever edits the tables (ROOKSTATS_REPORT)")
	f.Int("top", 50, "entries each ranked report lists, 0 for all; the problem and base-branch reports list every entry (ROOKSTATS_TOP)")
	return cmd
}

func checkInput(dir string) (classify.CheckInput, error) {
	t, err := tables.Load(dir)
	if err != nil {
		return classify.CheckInput{}, fmt.Errorf("check failed:\n%w", err)
	}
	recs, err := record.ReadRecords(dir)
	if err != nil {
		return classify.CheckInput{}, err
	}
	in := classify.CheckInput{Tables: t, Records: recs}
	switch m, err := record.ReadMeta(dir); {
	case err == nil:
		in.Meta = &m
	case !errors.Is(err, fs.ErrNotExist):
		return classify.CheckInput{}, err
	}
	return in, nil
}

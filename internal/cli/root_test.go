package cli_test

import (
	"bytes"
	"context"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/jhoblitt/ceph-dev-stats/internal/cli"
)

var _ = Describe("Run", func() {
	var stdout, stderr *bytes.Buffer

	BeforeEach(func() {
		stdout = &bytes.Buffer{}
		stderr = &bytes.Buffer{}
		for _, key := range []string{"CEPHSTATS_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"} {
			GinkgoT().Setenv(key, "")
		}
	})

	run := func(args ...string) error {
		return cli.Run(context.Background(), args, &bytes.Buffer{}, stdout, stderr)
	}

	It("lists every subcommand in its help", func() {
		Expect(run("--help")).To(Succeed())
		for _, name := range []string{"fetch", "extract", "tickets", "check", "rollup"} {
			Expect(stdout.String()).To(MatchRegexp(`(?m)^  %s\s`, name), "subcommand %q", name)
		}
	})

	// With no token and an endpoint under .invalid, fetch could reach no
	// one even if the log format were not checked first.
	It("rejects an unknown log format before running a subcommand", func() {
		Expect(run("--log-format", "xml", "fetch",
			"--api-url", "https://api.example.invalid/graphql",
			"--cache-dir", GinkgoT().TempDir(), "--data", GinkgoT().TempDir(),
		)).To(MatchError(`unknown log format "xml"`))
	})
})

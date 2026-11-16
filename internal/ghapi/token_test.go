package ghapi_test

import (
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/jhoblitt/rook-dev-stats/internal/ghapi"
)

var _ = Describe("Token", func() {
	env := func(vars map[string]string) func(string) string {
		return func(key string) string { return vars[key] }
	}

	DescribeTable("picks the first variable that is set",
		func(vars map[string]string, want string) {
			Expect(ghapi.Token(env(vars))).To(Equal(want))
		},
		Entry("ROOKSTATS_GITHUB_TOKEN over the others",
			map[string]string{"ROOKSTATS_GITHUB_TOKEN": "a", "GH_TOKEN": "b", "GITHUB_TOKEN": "c"}, "a"),
		Entry("GH_TOKEN over GITHUB_TOKEN",
			map[string]string{"GH_TOKEN": "b", "GITHUB_TOKEN": "c"}, "b"),
		Entry("GITHUB_TOKEN alone",
			map[string]string{"GITHUB_TOKEN": "c"}, "c"),
		Entry("an empty variable as unset",
			map[string]string{"ROOKSTATS_GITHUB_TOKEN": "", "GITHUB_TOKEN": "c"}, "c"),
	)

	It("is an error when no variable is set", func() {
		_, err := ghapi.Token(env(nil))
		Expect(err).To(MatchError(ghapi.ErrNoToken))
	})
})

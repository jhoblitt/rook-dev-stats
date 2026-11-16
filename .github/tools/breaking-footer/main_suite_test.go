package main

import (
	"testing"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

// Managed by go-conventions (references/testing.md owns the bootstrap):
// spec order is randomized within the suite and a committed Pending or
// focused spec fails the run under plain go test.
//
// ./... skips directories whose names begin with a dot, so make check never
// runs this suite; name the path: go test -race ./.github/tools/...
func TestBreakingFooter(t *testing.T) {
	RegisterFailHandler(Fail)
	suiteCfg, reporterCfg := GinkgoConfiguration()
	suiteCfg.RandomizeAllSpecs = true
	suiteCfg.FailOnPending = true
	RunSpecs(t, "breaking-footer suite", suiteCfg, reporterCfg)
}

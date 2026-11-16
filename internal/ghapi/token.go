// Package ghapi is the GitHub GraphQL transport: the token, the request,
// retries, rate limits, and the queries rookstats sends.
package ghapi

import "errors"

// ErrNoToken is returned when none of the token variables is set.
var ErrNoToken = errors.New("no GitHub token: set ROOKSTATS_GITHUB_TOKEN, GH_TOKEN or GITHUB_TOKEN")

// tokenVars are consulted in order; the first non-empty one wins.
var tokenVars = []string{"ROOKSTATS_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"}

// Token returns the GitHub token from the environment that getenv reads.
// The token is never taken from a flag or a file.
func Token(getenv func(string) string) (string, error) {
	for _, key := range tokenVars {
		if t := getenv(key); t != "" {
			return t, nil
		}
	}
	return "", ErrNoToken
}

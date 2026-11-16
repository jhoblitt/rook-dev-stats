package tables

import (
	"fmt"
	"strings"
)

// Bots is bots.yaml: accounts GitHub types as users whose activity is
// automated.
type Bots struct {
	Accounts []Account `yaml:"accounts"`

	listed map[string]bool
}

// Account is a bot account and why it is one.
type Account struct {
	Login string `yaml:"login"`
	Why   string `yaml:"why"`
}

// GitHub logins are case-insensitive, so the table is too.
func (b *Bots) validate() []error {
	var errs []error
	b.listed = map[string]bool{}
	for i, a := range b.Accounts {
		if a.Login == "" {
			errs = append(errs, fmt.Errorf("accounts: entry %d has no login", i+1))
			continue
		}
		if a.Why == "" {
			errs = append(errs, fmt.Errorf("accounts: %q has no why", a.Login))
		}
		login := strings.ToLower(a.Login)
		if b.listed[login] {
			errs = append(errs, fmt.Errorf("accounts: login %q appears twice", a.Login))
		}
		b.listed[login] = true
	}
	return errs
}

// Listed reports whether login, in any case, is a listed bot account.
func (b *Bots) Listed(login string) bool {
	return b.listed[strings.ToLower(login)]
}

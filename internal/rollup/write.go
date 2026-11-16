package rollup

import (
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
)

var (
	// ownName matches the names Build gives its files.
	ownName = regexp.MustCompile(`^(?:meta|index|(?:prs|events|table)-\d+)\.json$`)
	// ownTemp matches the temporary files writeIfChanged creates, which a
	// run that died can leave behind.
	ownTemp = regexp.MustCompile(`^\.(?:meta|index|(?:prs|events|table)-\d+)\.json\.\d+\.tmp$`)
)

// Result names the files Write wrote and removed.
type Result struct {
	// Written is in the order the files were given.
	Written []string
	// Removed is in name order.
	Removed []string
}

// Write writes files into dir, creating it, and rewrites only the files
// whose bytes change. It removes every file in dir named as the rollup
// names its files that files does not hold, such as those of a year that
// no longer holds a pull request, and leaves every other file alone.
//
// The site serves these files to everyone, so whatever the umask, each
// file in files ends up mode 0644, whether Write rewrote it or found it
// already holding its bytes, and every directory Write creates is 0755.
func Write(dir string, files []File) (Result, error) {
	var res Result
	keep := map[string]bool{}
	for _, f := range files {
		if !ownName.MatchString(f.Name) {
			return res, fmt.Errorf("%q is not the name of a site data file", f.Name)
		}
		keep[f.Name] = true
	}
	if err := mkdirPublic(dir); err != nil {
		return res, fmt.Errorf("creating %s: %w", dir, err)
	}
	for _, f := range files {
		changed, err := writeIfChanged(filepath.Join(dir, f.Name), f.Data)
		if err != nil {
			return res, err
		}
		if changed {
			res.Written = append(res.Written, f.Name)
		}
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return res, fmt.Errorf("listing %s: %w", dir, err)
	}
	for _, e := range entries {
		name := e.Name()
		if keep[name] || !e.Type().IsRegular() || !ownName.MatchString(name) && !ownTemp.MatchString(name) {
			continue
		}
		if err := os.Remove(filepath.Join(dir, name)); err != nil {
			return res, fmt.Errorf("removing %s: %w", filepath.Join(dir, name), err)
		}
		res.Removed = append(res.Removed, name)
	}
	return res, nil
}

// writeIfChanged replaces path with b through a temporary file and a
// rename, so a reader never sees a partial file, unless path already holds
// b.
func writeIfChanged(path string, b []byte) (bool, error) {
	old, err := os.ReadFile(path) //nolint:gosec // the output directory is the operator's to name
	switch {
	case err == nil && bytes.Equal(old, b):
		return false, publish(path)
	case err != nil && !errors.Is(err, fs.ErrNotExist):
		return false, fmt.Errorf("reading %s: %w", path, err)
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".*.tmp")
	if err != nil {
		return false, fmt.Errorf("writing %s: %w", path, err)
	}
	if err = replace(tmp, b, path); err != nil {
		return false, fmt.Errorf("writing %s: %w", path, errors.Join(err, os.Remove(tmp.Name())))
	}
	return true, nil
}

func replace(tmp *os.File, b []byte, path string) error {
	if err := tmp.Chmod(0o644); err != nil {
		return errors.Join(err, tmp.Close())
	}
	if _, err := tmp.Write(b); err != nil {
		return errors.Join(err, tmp.Close())
	}
	if err := tmp.Sync(); err != nil {
		return errors.Join(err, tmp.Close())
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}

// publish sets a file that Write does not rewrite, because it already holds
// its bytes, to mode 0644.
func publish(path string) error {
	fi, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("reading %s: %w", path, err)
	}
	if fi.Mode().Perm() == 0o644 {
		return nil
	}
	if err := os.Chmod(path, 0o644); err != nil { //nolint:gosec // the site serves this file to everyone
		return fmt.Errorf("setting the mode of %s: %w", path, err)
	}
	return nil
}

// mkdirPublic creates dir and its missing parents, each listable by
// everyone, and leaves the mode of every directory that already exists
// alone.
func mkdirPublic(dir string) error {
	var missing []string
	for d := dir; ; d = filepath.Dir(d) {
		if _, err := os.Lstat(d); !errors.Is(err, fs.ErrNotExist) {
			break
		}
		missing = append(missing, d)
		if filepath.Dir(d) == d {
			break
		}
	}
	if err := os.MkdirAll(dir, 0o755); err != nil { //nolint:gosec // the site serves this directory to everyone
		return err
	}
	for _, d := range missing {
		if err := os.Chmod(d, 0o755); err != nil { //nolint:gosec // the site serves this directory to everyone
			return err
		}
	}
	return nil
}

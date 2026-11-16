package record

import (
	"bytes"
	"cmp"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"time"
)

// Month is the name of the monthly file, without its extension, that holds
// a pull request opened at created.
func Month(created time.Time) string {
	return created.UTC().Format("2006-01")
}

// ReadRecords reads every record under dataDir/prs, sorted by number. A data
// directory without prs/ holds no records.
func ReadRecords(dataDir string) ([]Record, error) {
	paths, err := filepath.Glob(filepath.Join(dataDir, PRsDir, "*.jsonl"))
	if err != nil {
		return nil, fmt.Errorf("listing records: %w", err)
	}
	var recs []Record
	where := map[int]string{}
	for _, path := range paths {
		b, err := os.ReadFile(path) //nolint:gosec // the data directory is the operator's to name
		if err != nil {
			return nil, fmt.Errorf("reading %s: %w", path, err)
		}
		n := 0
		for line := range bytes.Lines(b) {
			n++
			var r Record
			if err := json.Unmarshal(line, &r); err != nil {
				return nil, fmt.Errorf("decoding %s:%d: %w", path, n, err)
			}
			if prev, ok := where[r.Number]; ok {
				return nil, fmt.Errorf("pull request %d is recorded twice, in %s and %s:%d", r.Number, prev, path, n)
			}
			where[r.Number] = fmt.Sprintf("%s:%d", path, n)
			recs = append(recs, r)
		}
	}
	slices.SortFunc(recs, func(a, b Record) int { return cmp.Compare(a.Number, b.Number) })
	return recs, nil
}

// WriteRecords files recs by the month each was opened, one line per record
// sorted by number, and rewrites only the monthly files whose bytes change.
// recs must be every record: a month's file is replaced by the records of
// that month in recs. It returns the paths it wrote, in order.
func WriteRecords(dataDir string, recs []Record) ([]string, error) {
	months := map[string][]Record{}
	for i := range recs {
		m := Month(recs[i].Created)
		months[m] = append(months[m], recs[i])
	}
	var written []string
	for _, m := range slices.Sorted(maps.Keys(months)) {
		path := filepath.Join(dataDir, PRsDir, m+".jsonl")
		b, err := encodeLines(months[m])
		if err != nil {
			return written, fmt.Errorf("encoding %s: %w", path, err)
		}
		changed, err := writeIfChanged(path, b)
		if err != nil {
			return written, err
		}
		if changed {
			written = append(written, path)
		}
	}
	return written, nil
}

func encodeLines(recs []Record) ([]byte, error) {
	slices.SortFunc(recs, func(a, b Record) int { return cmp.Compare(a.Number, b.Number) })
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	// Titles and comments are text, not HTML; escaping them only makes
	// the files harder to read.
	enc.SetEscapeHTML(false)
	for i := range recs {
		if err := enc.Encode(&recs[i]); err != nil {
			return nil, fmt.Errorf("pull request %d: %w", recs[i].Number, err)
		}
	}
	return buf.Bytes(), nil
}

// ReadMeta reads dataDir/meta.json. A missing file is an error that matches
// fs.ErrNotExist, and a meta without fetched_through is an error.
func ReadMeta(dataDir string) (Meta, error) {
	path := filepath.Join(dataDir, MetaFile)
	var m Meta
	if err := readJSON(path, &m); err != nil {
		return Meta{}, err
	}
	if m.FetchedThrough.IsZero() {
		return Meta{}, fmt.Errorf("%s has no fetched_through", path)
	}
	return m, nil
}

// WriteMeta writes dataDir/meta.json unless it already holds m, and reports
// whether it wrote.
func WriteMeta(dataDir string, m Meta) (bool, error) {
	return writeIndented(filepath.Join(dataDir, MetaFile), m)
}

// ReadAuthors reads dataDir/authors.json: each author's count of pull
// requests opened before dataDir/meta.json's window_start, which the file
// does not record itself. A missing file is an error that matches
// fs.ErrNotExist.
func ReadAuthors(dataDir string) (map[string]int, error) {
	authors := map[string]int{}
	if err := readJSON(filepath.Join(dataDir, AuthorsFile), &authors); err != nil {
		return nil, err
	}
	return authors, nil
}

// WriteAuthors writes dataDir/authors.json, keys sorted, unless it already
// holds authors, and reports whether it wrote.
func WriteAuthors(dataDir string, authors map[string]int) (bool, error) {
	return writeIndented(filepath.Join(dataDir, AuthorsFile), authors)
}

func readJSON(path string, v any) error {
	b, err := os.ReadFile(path) //nolint:gosec // the data directory is the operator's to name
	if err != nil {
		return fmt.Errorf("reading %s: %w", path, err)
	}
	if err := json.Unmarshal(b, v); err != nil {
		return fmt.Errorf("decoding %s: %w", path, err)
	}
	return nil
}

func writeIndented(path string, v any) (bool, error) {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return false, fmt.Errorf("encoding %s: %w", path, err)
	}
	return writeIfChanged(path, append(b, '\n'))
}

// writeIfChanged replaces path with b through a temporary file and a
// rename, so a reader never sees a partial file, unless path already holds
// b.
func writeIfChanged(path string, b []byte) (bool, error) {
	old, err := os.ReadFile(path) //nolint:gosec // the data directory is the operator's to name
	switch {
	case err == nil && bytes.Equal(old, b):
		return false, nil
	case err != nil && !errors.Is(err, fs.ErrNotExist):
		return false, fmt.Errorf("reading %s: %w", path, err)
	}
	dir := filepath.Dir(path)
	if err = os.MkdirAll(dir, 0o750); err != nil {
		return false, fmt.Errorf("creating %s: %w", dir, err)
	}
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(path)+".*.tmp")
	if err != nil {
		return false, fmt.Errorf("writing %s: %w", path, err)
	}
	if err = replace(tmp, b, path); err != nil {
		return false, fmt.Errorf("writing %s: %w", path, errors.Join(err, os.Remove(tmp.Name())))
	}
	return true, nil
}

func replace(tmp *os.File, b []byte, path string) error {
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

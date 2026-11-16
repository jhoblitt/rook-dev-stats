package tracker

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strconv"
)

// Read reads dataDir/tickets.json. A missing file holds no tickets.
func Read(dataDir string) (map[int]Ticket, error) {
	path := filepath.Join(dataDir, File)
	b, err := os.ReadFile(path) //nolint:gosec // the data directory is the operator's to name
	if errors.Is(err, fs.ErrNotExist) {
		return map[int]Ticket{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading %s: %w", path, err)
	}
	tickets := map[int]Ticket{}
	if err := json.Unmarshal(b, &tickets); err != nil {
		return nil, fmt.Errorf("decoding %s: %w", path, err)
	}
	return tickets, nil
}

// Write writes dataDir/tickets.json, one ticket a line in numeric order,
// unless the file already holds exactly those bytes, and reports whether it
// wrote. A file with any other content, tickets or not, is replaced, through
// a temporary file and a rename, so a reader never sees a partial one.
func Write(dataDir string, tickets map[int]Ticket) (bool, error) {
	path := filepath.Join(dataDir, File)
	b, err := encode(tickets)
	if err != nil {
		return false, fmt.Errorf("encoding %s: %w", path, err)
	}
	old, err := os.ReadFile(path) //nolint:gosec // the data directory is the operator's to name
	switch {
	case err == nil && bytes.Equal(old, b):
		return false, nil
	case err != nil && !errors.Is(err, fs.ErrNotExist):
		return false, fmt.Errorf("reading %s: %w", path, err)
	}
	if err = os.MkdirAll(dataDir, 0o750); err != nil {
		return false, fmt.Errorf("creating %s: %w", dataDir, err)
	}
	tmp, err := os.CreateTemp(dataDir, "."+File+".*.tmp")
	if err != nil {
		return false, fmt.Errorf("writing %s: %w", path, err)
	}
	if err = replace(tmp, b, path); err != nil {
		return false, fmt.Errorf("writing %s: %w", path, errors.Join(err, os.Remove(tmp.Name())))
	}
	return true, nil
}

// encode lays the tickets out by hand: encoding/json orders integer keys
// as strings, so 10 would come before 9.
func encode(tickets map[int]Ticket) ([]byte, error) {
	if len(tickets) == 0 {
		return []byte("{}\n"), nil
	}
	var buf bytes.Buffer
	buf.WriteString("{\n")
	for i, id := range slices.Sorted(maps.Keys(tickets)) {
		v, err := json.Marshal(tickets[id])
		if err != nil {
			return nil, fmt.Errorf("ticket %d: %w", id, err)
		}
		if i > 0 {
			buf.WriteString(",\n")
		}
		buf.WriteString(`  "` + strconv.Itoa(id) + `": `)
		buf.Write(v)
	}
	buf.WriteString("\n}\n")
	return buf.Bytes(), nil
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

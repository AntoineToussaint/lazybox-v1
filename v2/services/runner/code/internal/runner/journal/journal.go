// Package journal provides a bounded append-only, fsynced event spool. Readers
// use independent cursors and wakeups; there is no per-viewer producer queue.
package journal

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"sync"
	"time"
)

var ErrFull = errors.New("journal capacity exhausted")
var ErrCursor = errors.New("cursor outside retained range")

type Record struct {
	Sequence uint64          `json:"sequence"`
	Time     time.Time       `json:"time"`
	Value    json.RawMessage `json:"value"`
}

type Journal struct {
	mu          sync.Mutex
	f           *os.File
	positions   []int64
	size, limit int64
	notify      chan struct{}
	closed      bool
	// The records Marking selects, by sequence, ascending.
	mark  func(json.RawMessage) bool
	marks []uint64
}

// Option configures a journal as it opens.
type Option func(*Journal)

// Marking indexes the records whose value mark selects (a conversation's turn
// starts) as the journal is read at open and as records are appended, so a
// reader finds them without parsing the file. mark sees each value once.
func Marking(mark func(json.RawMessage) bool) Option {
	return func(j *Journal) { j.mark = mark }
}

func Open(path string, limit int64, options ...Option) (*Journal, error) {
	return open(path, limit, false, options)
}

// OpenExisting reads retained evidence without creating or changing a file.
func OpenExisting(path string, limit int64, options ...Option) (*Journal, error) {
	return open(path, limit, true, options)
}
func open(path string, limit int64, readonly bool, options []Option) (*Journal, error) {
	if limit < 1024 {
		return nil, errors.New("journal budget must be at least 1024 bytes")
	}
	flags := os.O_CREATE | os.O_RDWR
	if readonly {
		flags = os.O_RDONLY
	}
	f, err := os.OpenFile(path, flags, 0600)
	if err != nil {
		return nil, err
	}
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, err
	}
	if info.Size() > limit {
		f.Close()
		return nil, ErrFull
	}
	j := &Journal{f: f, limit: limit, notify: make(chan struct{})}
	for _, option := range options {
		option(j)
	}
	r := bufio.NewReader(f)
	for {
		line, e := r.ReadBytes('\n')
		if e == io.EOF && len(line) == 0 {
			break
		}
		if e != nil {
			f.Close()
			return nil, fmt.Errorf("incomplete journal at %d: %w", j.size, e)
		}
		var record Record
		if e = json.Unmarshal(line, &record); e != nil || record.Sequence != uint64(len(j.positions)+1) {
			f.Close()
			return nil, fmt.Errorf("corrupt journal at %d", j.size)
		}
		j.positions = append(j.positions, j.size)
		j.size += int64(len(line))
		if j.mark != nil && j.mark(record.Value) {
			j.marks = append(j.marks, record.Sequence)
		}
		if j.size > limit {
			f.Close()
			return nil, ErrFull
		}
	}
	if readonly {
		j.closed = true
		close(j.notify)
	}
	return j, nil
}

func (j *Journal) Append(value any) (Record, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.closed {
		return Record{}, os.ErrClosed
	}
	b, err := json.Marshal(value)
	if err != nil {
		return Record{}, err
	}
	r := Record{Sequence: uint64(len(j.positions) + 1), Time: time.Now().UTC(), Value: b}
	marked := j.mark != nil && j.mark(b)
	b, err = json.Marshal(r)
	if err != nil {
		return Record{}, err
	}
	b = append(b, '\n')
	if j.size+int64(len(b)) > j.limit {
		return Record{}, ErrFull
	}
	n, err := j.f.WriteAt(b, j.size)
	if err == nil && n != len(b) {
		err = io.ErrShortWrite
	}
	if err == nil {
		err = j.f.Sync()
	}
	if err != nil {
		j.closed = true
		close(j.notify)
		j.f.Close()
		return Record{}, err
	}
	j.positions = append(j.positions, j.size)
	j.size += int64(n)
	if marked {
		j.marks = append(j.marks, r.Sequence)
	}
	close(j.notify)
	j.notify = make(chan struct{})
	return r, nil
}

// Next returns the record after cursor; cancellation affects this reader only.
func (j *Journal) Next(ctx context.Context, cursor uint64) (Record, error) {
	for {
		j.mu.Lock()
		if cursor > uint64(len(j.positions)) {
			j.mu.Unlock()
			return Record{}, ErrCursor
		}
		if cursor < uint64(len(j.positions)) {
			start := j.positions[cursor]
			end := j.size
			if int(cursor)+1 < len(j.positions) {
				end = j.positions[cursor+1]
			}
			b := make([]byte, end-start)
			_, err := j.f.ReadAt(b, start)
			j.mu.Unlock()
			if err != nil {
				return Record{}, err
			}
			var r Record
			err = json.Unmarshal(b, &r)
			return r, err
		}
		if j.closed {
			j.mu.Unlock()
			return Record{}, io.EOF
		}
		wake := j.notify
		j.mu.Unlock()
		select {
		case <-ctx.Done():
			return Record{}, ctx.Err()
		case <-wake:
		}
	}
}

// Marks returns the sequences of the marked records (see Marking), ascending.
func (j *Journal) Marks() []uint64 {
	j.mu.Lock()
	defer j.mu.Unlock()
	return append([]uint64(nil), j.marks...)
}

// end is where record n ends in the file (zero: the start); j.mu is held.
func (j *Journal) end(n uint64) int64 {
	if n < uint64(len(j.positions)) {
		return j.positions[n]
	}
	return j.size
}

// Span is the size in bytes of the records after `after` up to `upTo`.
func (j *Journal) Span(after, upTo uint64) int64 {
	j.mu.Lock()
	defer j.mu.Unlock()
	upTo = min(upTo, uint64(len(j.positions)))
	if after >= upTo {
		return 0
	}
	return j.end(upTo) - j.end(after)
}

// Fit returns the earliest `after` for which the records after it up to
// `upTo` fit in budget bytes: upTo itself when not even the last one does.
func (j *Journal) Fit(upTo uint64, budget int64) uint64 {
	j.mu.Lock()
	defer j.mu.Unlock()
	upTo = min(upTo, uint64(len(j.positions)))
	stop := j.end(upTo)
	// The span grows as `after` falls: the first that fits, by binary search.
	low, high := uint64(0), upTo
	for low < high {
		mid := low + (high-low)/2
		if stop-j.end(mid) <= budget {
			high = mid
		} else {
			low = mid + 1
		}
	}
	return low
}

// Range returns the records after `after` up to `upTo`, read in one pass.
func (j *Journal) Range(after, upTo uint64) ([]Record, error) {
	j.mu.Lock()
	if upTo > uint64(len(j.positions)) || after > upTo {
		j.mu.Unlock()
		return nil, ErrCursor
	}
	if after == upTo {
		j.mu.Unlock()
		return nil, nil
	}
	start := j.end(after)
	b := make([]byte, j.end(upTo)-start)
	bounds := append([]int64(nil), j.positions[after:upTo]...)
	f := j.f
	j.mu.Unlock()
	// Written records never change: a large read does not hold appends back.
	_, err := f.ReadAt(b, start)
	if err != nil {
		return nil, err
	}
	records := make([]Record, len(bounds))
	for i, at := range bounds {
		stop := int64(len(b))
		if i+1 < len(bounds) {
			stop = bounds[i+1] - start
		}
		if err = json.Unmarshal(b[at-start:stop], &records[i]); err != nil {
			return nil, err
		}
	}
	return records, nil
}

func (j *Journal) Count() uint64 { j.mu.Lock(); defer j.mu.Unlock(); return uint64(len(j.positions)) }
func (j *Journal) Close() error {
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.closed {
		return nil
	}
	j.closed = true
	close(j.notify)
	// Retain the descriptor until readers have replayed; callers close readers
	// before releasing the journal with Dispose.
	return nil
}
func (j *Journal) Dispose() error { _ = j.Close(); return j.f.Close() }

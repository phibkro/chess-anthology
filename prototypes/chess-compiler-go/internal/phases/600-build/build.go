// Package build owns mutable incremental state and publishes defensive snapshot values.
package build

import (
	"encoding/json"
	"sort"
	"strings"
	"sync"

	c "github.com/phibkro/chess-anthology/compiler/contracts"
	parsing "github.com/phibkro/chess-anthology/compiler/internal/phases/100-parsing"
	linking "github.com/phibkro/chess-anthology/compiler/internal/phases/300-linking"
	chess "github.com/phibkro/chess-anthology/compiler/internal/phases/400-chess-analysis"
	emission "github.com/phibkro/chess-anthology/compiler/internal/phases/500-emission"
)

type Compiler struct {
	mu       sync.Mutex
	sources  map[string]c.Text
	syntax   map[string]parsing.Syntax
	replays  map[string]emission.GameAnalysis
	output   map[string]c.Emitted
	snapshot c.Snapshot
}

func New() *Compiler {
	return &Compiler{sources: map[string]c.Text{}, syntax: map[string]parsing.Syntax{}, replays: map[string]emission.GameAnalysis{}, output: map[string]c.Emitted{}, snapshot: c.Snapshot{Games: []c.GameResult{}, Output: []c.Emitted{}}}
}
func clone[T any](v T) (T, *c.Failure) {
	var out T
	b, e := json.Marshal(v)
	if e == nil {
		e = json.Unmarshal(b, &out)
	}
	if e != nil {
		return out, c.Fail("infrastructure", "build/failure", e.Error())
	}
	return out, nil
}
func (b *Compiler) Update(next map[string]c.Text) (c.Update, *c.Failure) {
	order := []string{}
	for uri := range next {
		order = append(order, uri)
	}
	sort.Strings(order)
	return b.update(next, order)
}

// UpdateOrdered retains configured source order while copying all input values.
func (b *Compiler) UpdateOrdered(items []c.Source) (c.Update, *c.Failure) {
	next := map[string]c.Text{}
	order := []string{}
	for _, item := range items {
		uri := string(item.URI)
		if _, exists := next[uri]; !exists {
			order = append(order, uri)
		}
		next[uri] = item.Text
	}
	return b.update(next, order)
}
func (b *Compiler) update(next map[string]c.Text, order []string) (c.Update, *c.Failure) {
	if !b.mu.TryLock() {
		return c.Update{}, c.Fail("infrastructure", "build/busy", "Await the current update before starting another.")
	}
	defer b.mu.Unlock()
	changed := map[string]bool{}
	for uri, text := range next {
		if old, ok := b.sources[uri]; !ok || old != text {
			changed[uri] = true
		}
	}
	for uri := range b.sources {
		if _, ok := next[uri]; !ok {
			changed[uri] = true
		}
	}
	if len(changed) == 0 {
		s, f := clone(b.snapshot)
		return c.Update{Snapshot: s}, f
	}
	affected := map[string]bool{}
	for u := range changed {
		affected[u] = true
	}
	reverse := map[string][]string{}
	dependencies := func(uri string, p parsing.Syntax) {
		if p.Data == nil {
			return
		}
		paths := append([]c.Text{}, p.Data.Imports...)
		for _, g := range p.Data.Games {
			paths = append(paths, g.Source)
		}
		for _, path := range paths {
			dep := linking.Relative(uri, path)
			reverse[dep] = append(reverse[dep], uri)
		}
	}
	for uri, p := range b.syntax {
		dependencies(uri, p)
	}
	work := c.Work{}
	for uri := range changed {
		if !strings.HasSuffix(uri, ".chess-story") {
			continue
		}
		if text, ok := next[uri]; ok {
			b.syntax[uri] = parsing.Parse(text)
			work.Parsed++
		} else {
			delete(b.syntax, uri)
			delete(b.output, uri)
		}
	}
	for uri, p := range b.syntax {
		dependencies(uri, p)
	}
	queue := []string{}
	for uri := range affected {
		queue = append(queue, uri)
	}
	for i := 0; i < len(queue); i++ {
		for _, dep := range reverse[queue[i]] {
			if !affected[dep] {
				affected[dep] = true
				queue = append(queue, dep)
			}
		}
	}
	sources := map[string]c.Text{}
	for uri, text := range next {
		sources[uri] = text
	}
	modules := map[string]*c.Document{}
	for uri, p := range b.syntax {
		modules[uri] = p.Data
	}
	games := map[string]emission.GameAnalysis{}
	gameURIs := map[string]bool{}
	for uri := range sources {
		if strings.HasSuffix(uri, ".pgn") {
			gameURIs[uri] = true
		}
	}
	for uri, d := range modules {
		if d != nil {
			for _, g := range d.Games {
				gameURIs[linking.Relative(uri, g.Source)] = true
			}
		}
	}
	for uri := range gameURIs {
		source, ok := sources[uri]
		if !ok {
			continue
		}
		key := c.Digest(source)
		analysis, ok := b.replays[key]
		if !ok {
			r, f := chess.ReplayPGN(source)
			analysis = emission.GameAnalysis{Replay: r, Failure: f}
			b.replays[key] = analysis
			work.Replayed++
		}
		games[uri] = analysis
	}
	for uri := range affected {
		if p, ok := b.syntax[uri]; ok {
			b.output[uri] = emission.Emit(uri, sources[uri], p, modules, sources, games)
			work.Emitted++
		}
	}
	snapshot := c.Snapshot{Games: []c.GameResult{}, Output: []c.Emitted{}, Revision: b.snapshot.Revision + 1}
	parent := b.snapshot.Revision
	snapshot.ParentRevision = &parent
	uris := []string{}
	for _, uri := range order {
		if strings.HasSuffix(uri, ".pgn") {
			uris = append(uris, uri)
		}
	}
	for _, uri := range uris {
		a := games[uri]
		r := c.Failed[c.History](a.Failure)
		if a.Replay != nil {
			r = c.Success(a.Replay.History)
		}
		snapshot.Games = append(snapshot.Games, c.GameResult{URI: uri, Result: r})
	}
	uris = uris[:0]
	for uri := range b.output {
		uris = append(uris, uri)
	}
	sort.Strings(uris)
	for _, uri := range uris {
		snapshot.Output = append(snapshot.Output, b.output[uri])
	}
	b.sources = sources
	b.snapshot = snapshot
	copy, f := clone(snapshot)
	return c.Update{Snapshot: copy, Work: work}, f
}

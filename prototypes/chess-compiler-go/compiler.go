// Package compiler exposes lossless narrative compilation, recorded history and playback.
package compiler

import (
	"encoding/json"

	c "github.com/phibkro/chess-anthology/compiler/contracts"
	semantic "github.com/phibkro/chess-anthology/compiler/internal/phases/200-semantic-analysis"
	emission "github.com/phibkro/chess-anthology/compiler/internal/phases/500-emission"
	build "github.com/phibkro/chess-anthology/compiler/internal/phases/600-build"
)

type Compiler = build.Compiler

// CreateCompiler starts an isolated incremental workspace and replay cache.
func CreateCompiler() *Compiler { return build.New() }

// Compile builds a fresh workspace; map inputs are ordered deterministically by URI.
func Compile(sources map[string]c.Text) (c.Snapshot, *c.Failure) {
	u, f := CreateCompiler().Update(sources)
	return u.Snapshot, f
}

// Decode parses flat narrative text and validates its authored structure without linking.
func Decode(source c.Text) (c.Document, *c.Failure) { return emission.Decode(source) }

// ParseStructured rejects invalid or unknown authored data before it reaches compiler phases.
func ParseStructured(raw json.RawMessage) (c.Document, *c.Failure) {
	return semantic.ParseStructured(raw)
}

// PrintStructured emits canonical narrative source while preserving the document model.
func PrintStructured(raw json.RawMessage) (c.Text, *c.Failure) { return emission.PrintStructured(raw) }

// Envelope pairs the model with unchanged source for verified restoration.
func Envelope(d c.Document, source c.Text) c.Envelope { return emission.Envelope(d, source) }

// Restore returns exact source only when format, digest and authored model still agree.
func Restore(raw json.RawMessage) (c.Text, *c.Failure) { return emission.Restore(raw) }

// CreatePlaybackPlan rejects invalid imports and unsupported prompt continuations.
func CreatePlaybackPlan(snapshot c.Snapshot, entry, story string) (c.Plan, *c.Failure) {
	return emission.Playback(snapshot, entry, story)
}

// SelectPosition reads a frame without changing revisions or aliasing snapshot pointers.
func SelectPosition(snapshot c.Snapshot, uri string, ply c.Integer) (c.Frame, *c.Failure) {
	if ply < 0 || ply > 9007199254740991 {
		return c.Frame{}, c.Fail("selection", "view/invalid-ply", "Ply must be a nonnegative safe integer.")
	}
	for _, g := range snapshot.Games {
		if g.URI == uri {
			if g.Result.OK && (g.Result.Value == nil || g.Result.Error != nil) || !g.Result.OK && (g.Result.Error == nil || g.Result.Value != nil) {
				return c.Frame{}, c.Fail("schema", "snapshot/invalid-shape", "Game history result has an invalid discriminant or payload.")
			}
			if !g.Result.OK {
				failure := *g.Result.Error
				return c.Frame{}, &failure
			}
			if int64(ply) >= int64(len(g.Result.Value.Frames)) {
				return c.Frame{}, c.Fail("selection", "view/missing-position", "Position is unavailable in this history.")
			}
			f := g.Result.Value.Frames[ply]
			if f.SAN != nil {
				v := *f.SAN
				f.SAN = &v
			}
			if f.UCI != nil {
				v := *f.UCI
				f.UCI = &v
			}
			return f, nil
		}
	}
	return c.Frame{}, c.Fail("selection", "view/missing-game", "Game is unavailable in this snapshot.")
}

// CompileOrdered preserves the configured source ordering used by the TypeScript Map API.
func CompileOrdered(sources []c.Source) (c.Snapshot, *c.Failure) {
	u, f := CreateCompiler().UpdateOrdered(sources)
	return u.Snapshot, f
}

package emission

import (
	"fmt"
	"regexp"
	"strings"

	c "github.com/phibkro/chess-anthology/compiler/contracts"
	parsing "github.com/phibkro/chess-anthology/compiler/internal/phases/100-parsing"
	semantic "github.com/phibkro/chess-anthology/compiler/internal/phases/200-semantic-analysis"
	linking "github.com/phibkro/chess-anthology/compiler/internal/phases/300-linking"
	chess "github.com/phibkro/chess-anthology/compiler/internal/phases/400-chess-analysis"
)

type GameAnalysis struct {
	Replay  *chess.Replay
	Failure *c.Failure
}

var square = regexp.MustCompile(`^[a-h][1-8]$`)

func Emit(uri string, source c.Text, p parsing.Syntax, modules map[string]*c.Document, sources map[string]c.Text, games map[string]GameAnalysis) c.Emitted {
	out := c.Emitted{URI: uri, SourceText: source, Diagnostics: append([]c.Diagnostic{}, p.Diagnostics...), Occurrences: []c.Occurrence{}}
	if p.Data == nil {
		return out
	}
	d := *p.Data
	add := func(code, message, path string) {
		phase, stage := "200-semantic-analysis", "semantic"
		if strings.HasPrefix(code, "link/") {
			phase, stage = "300-linking", "linking"
		} else if strings.HasPrefix(code, "source/") {
			phase, stage = "300-linking", "acquisition"
		} else if strings.HasPrefix(code, "chess/") || strings.HasPrefix(code, "annotation/") {
			phase, stage = "400-chess-analysis", "chess"
		}
		span, ok := p.Spans[path]
		if !ok {
			span = p.Spans["name"]
		}
		out.Diagnostics = append(out.Diagnostics, c.Diagnostic{Code: code, Message: message, Phase: phase, Stage: stage, Range: span, Severity: 1})
	}
	if f := semantic.Validate(d); f != nil {
		add(f.Code, f.Message, "name")
		return out
	}
	out.Data = &d
	for _, issue := range semantic.Analyze(d) {
		add(issue.Code, issue.Message, issue.Path)
	}
	visible := linking.Visible(uri, d, modules)
	imported := map[string]bool{}
	for i, path := range d.Imports {
		u := linking.Relative(uri, path)
		target, present := modules[u]
		if !present {
			add("link/missing-module", "Unavailable module "+string(path)+".", parsing.Path("imports", i))
			continue
		}
		if target == nil {
			continue
		}
		for _, g := range target.Games {
			if g.Exported {
				if imported[g.Name] {
					add("link/ambiguous-game", "Ambiguous imported game "+g.Name+".", parsing.Path("imports", i))
				}
				imported[g.Name] = true
			}
		}
	}
	if linking.Cycle(uri, modules) {
		add("link/import-cycle", "Import cycle.", "name")
	}
	for i, g := range d.Games {
		u := linking.Relative(uri, g.Source)
		if _, ok := sources[u]; !ok {
			add("source/missing-game", "Unavailable PGN "+string(g.Source)+".", parsing.Path("games", i, "source"))
		} else if analysis := games[u]; analysis.Failure != nil {
			add("chess/invalid-game", analysis.Failure.Message, parsing.Path("games", i, "source"))
		}
	}
	for si, s := range d.Stories {
		for bi, b := range s.Scenes {
			base := parsing.Path("stories", si, "scenes", bi)
			ref, ok := visible[b.Game]
			if !ok {
				add("link/unresolved-game", "Could not resolve reference to Game named '"+b.Game+"'.", base+".game")
				continue
			}
			u := linking.Relative(ref.URI, ref.Game.Source)
			analysis, ok := games[u]
			if !ok || analysis.Failure != nil || analysis.Replay == nil {
				continue
			}
			fen, moves, ok := analysis.Replay.Position(b.Ply)
			if !ok {
				add("chess/missing-position", fmt.Sprintf("No recorded position after ply %d.", b.Ply), base+".ply")
				continue
			}
			out.Occurrences = append(out.Occurrences, c.Occurrence{FEN: fen, Game: ref.URI + "#" + ref.Game.Name, ID: uri + "#" + s.Name + "/" + b.Name, LegalMoves: moves, Ply: b.Ply, SourceDigest: c.Digest(sources[u]), SourceURI: u})
			for ni, n := range b.Notes {
				np := parsing.Path(base, "notes", ni)
				if n.Type == "prompt" && !analysis.Replay.LegalAnswer(b.Ply, string(n.Answer)) {
					add("chess/illegal-answer", string(n.Answer)+" is not legal at this position.", np+".answer")
				}

				if n.Type == "arrow" {
					if !square.MatchString(string(n.From)) || !square.MatchString(string(n.To)) {
						add("annotation/invalid-square", "Arrow endpoints must be chess squares.", np+".from")
					}
					if n.Color != "green" && n.Color != "red" && n.Color != "blue" && n.Color != "yellow" {
						add("annotation/unsupported-color", "Unsupported brush "+n.Color+".", np+".color")
					}
				}
			}
		}
	}
	return out
}
func Playback(snapshot c.Snapshot, entryURI, storyName string) (c.Plan, *c.Failure) {
	bad := func(code, message string) (c.Plan, *c.Failure) { return c.Plan{}, c.Fail("selection", code, message) }
	docs := map[string]c.Emitted{}
	for _, d := range snapshot.Output {
		docs[d.URI] = d
	}
	entry, ok := docs[entryURI]
	if !ok || entry.Data == nil {
		return bad("plan/missing-story", "Story is unavailable.")
	}
	var story *c.Story
	for _, s := range entry.Data.Stories {
		if s.Name == storyName {
			v := s
			story = &v
			break
		}
	}
	if story == nil {
		return bad("plan/missing-story", "Story is unavailable.")
	}
	seen := map[string]bool{}
	pending := []string{entryURI}
	for len(pending) > 0 {
		u := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if seen[u] {
			continue
		}
		seen[u] = true
		d, ok := docs[u]
		if !ok {
			return bad("plan/missing-module", "An imported module is unavailable.")
		}
		for _, issue := range d.Diagnostics {
			if issue.Severity == 1 {
				return c.Plan{}, c.Fail("schema", "plan/invalid-content", "Resolve source diagnostics before producing a playable story.")
			}
		}
		if d.Data != nil {
			for _, path := range d.Data.Imports {
				pending = append(pending, linking.Relative(u, path))
			}
		}
	}
	plan := c.Plan{Format: "chess-playback-plan", Version: 1, ID: entry.Data.Name + "/" + storyName, Scenes: []c.PlaybackScene{}}
	for _, scene := range story.Scenes {
		var occurrence *c.Occurrence
		for _, o := range entry.Occurrences {
			if o.ID == entryURI+"#"+storyName+"/"+scene.Name {
				v := o
				occurrence = &v
				break
			}
		}
		if occurrence == nil {
			return bad("plan/missing-game", "A board's game history is unavailable.")
		}
		var history *c.History
		for _, g := range snapshot.Games {
			if g.URI == occurrence.SourceURI && g.Result.OK {
				history = g.Result.Value
				break
			}
		}
		if history == nil {
			return bad("plan/missing-game", "A board's game history is unavailable.")
		}
		notes := append([]c.Note{}, scene.Notes...)
		prompts := 0
		for i, n := range notes {
			if n.Type != "prompt" {
				continue
			}
			prompts++
			answer := ""
			for _, m := range occurrence.LegalMoves {
				if m.SAN == string(n.Answer) {
					answer = m.UCI
					break
				}
			}
			next := int64(scene.Ply) + 1
			if prompts > 1 || answer == "" || next >= int64(len(history.Frames)) || history.Frames[next].UCI == nil || *history.Frames[next].UCI != answer {
				return bad("plan/unsupported-prompt", "This playback target requires one canonical SAN answer following the recorded line per board.")
			}
			notes[i].AnswerUCI = answer
		}
		plan.Scenes = append(plan.Scenes, c.PlaybackScene{After: scene.Ply, Frames: copyFrames(history.Frames), Game: scene.Game, ID: scene.Name, Notes: notes, SourceDigest: occurrence.SourceDigest})
	}
	if len(plan.Scenes) == 0 {
		return c.Plan{}, c.Fail("schema", "plan/invalid-shape", "Invalid playback plan.")
	}
	return plan, nil
}

func copyFrames(frames []c.Frame) []c.Frame {
	out := make([]c.Frame, len(frames))
	for i, f := range frames {
		out[i] = f
		if f.SAN != nil {
			v := *f.SAN
			out[i].SAN = &v
		}
		if f.UCI != nil {
			v := *f.UCI
			out[i].UCI = &v
		}
	}
	return out
}

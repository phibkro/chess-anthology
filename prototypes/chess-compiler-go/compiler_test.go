package compiler_test

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	compiler "github.com/phibkro/chess-anthology/compiler"
	c "github.com/phibkro/chess-anthology/compiler/contracts"
)

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	b, e := os.ReadFile("../chess-compiler/evaluation/corpus/" + name)
	if e != nil {
		t.Fatal(e)
	}
	return b
}
func TestCodec(t *testing.T) {
	for _, raw := range []string{`"\ud800"`, `"line\r\n\u0000😀"`, `"quote\"\\"`} {
		source := c.Text("// trivia\r\nmodule demo; story lesson { board b game example after 0 { text " + raw + "; } }")
		d, f := compiler.Decode(source)
		if f != nil {
			t.Fatal(f)
		}
		b, _ := json.Marshal(d)
		printed, f := compiler.PrintStructured(b)
		if f != nil {
			t.Fatal(f)
		}
		again, f := compiler.Decode(printed)
		if f != nil {
			t.Fatal(f)
		}
		b2, _ := json.Marshal(again)
		if string(b) != string(b2) {
			t.Fatal("codec roundtrip")
		}
		e := compiler.Envelope(d, source)
		eb, _ := json.Marshal(e)
		out, f := compiler.Restore(eb)
		if f != nil || out != source {
			t.Fatal("exact restore", f)
		}
		e.SourceText += "\n"
		eb, _ = json.Marshal(e)
		if _, f = compiler.Restore(eb); f == nil {
			t.Fatal("modified digest accepted")
		}
	}
}
func TestStructuredRejections(t *testing.T) {
	base := `{"formatVersion":0,"name":"x","imports":[],"games":[],"stories":[]}`
	for _, bad := range []string{strings.Replace(base, `"imports":[]`, `"imports":null`, 1), strings.Replace(base, `"name":"x"`, `"name":"module"`, 1), strings.Replace(base, `"games":[]`, `"unknown":[]`, 1), strings.Replace(base, `"stories":[]`, `"stories":[{"name":"s","scenes":[{"game":"g","name":"b","notes":[],"ply":-0}]}]`, 1)} {
		if _, f := compiler.ParseStructured([]byte(bad)); f == nil {
			t.Fatal("invalid shape accepted", bad)
		}
	}
}
func TestCorpusAndSnapshots(t *testing.T) {
	sources := map[string]c.Text{}
	for _, name := range []string{"story.chess-story", "opening.pgn", "composition.pgn", "reti.pgn"} {
		sources["file:///corpus/"+name] = c.Text(fixture(t, name))
	}
	comp := compiler.CreateCompiler()
	first, f := comp.Update(sources)
	if f != nil {
		t.Fatal(f)
	}
	for _, d := range first.Snapshot.Output {
		if len(d.Diagnostics) > 0 {
			t.Fatal(d.Diagnostics)
		}
	}
	plan, f := compiler.CreatePlaybackPlan(first.Snapshot, "file:///corpus/story.chess-story", "contexts")
	if f != nil || len(plan.Scenes) != 3 {
		t.Fatal("plan", f)
	}
	next := map[string]c.Text{}
	for k, v := range sources {
		next[k] = v
	}
	next["file:///corpus/story.chess-story"] += "\n// edit"
	second, f := comp.Update(next)
	if f != nil || second.Work != (c.Work{Parsed: 1, Emitted: 1}) {
		t.Fatal("reuse", second.Work, f)
	}
	first.Snapshot.Output[0].Data.Name = "mutated"
	same, f := comp.Update(next)
	if f != nil || same.Work != (c.Work{}) || same.Snapshot.Output[0].Data.Name == "mutated" {
		t.Fatal("snapshot alias")
	}
	if second.Snapshot.Revision != 2 || second.Snapshot.ParentRevision == nil || *second.Snapshot.ParentRevision != 1 {
		t.Fatal("revision")
	}
}
func TestChess960(t *testing.T) {
	var cases struct {
		Accepted []struct{ ID, FEN, Moves, ExpectedFen, ExpectedUci string }
		Rejected []struct{ ID, FEN, Moves, ExpectedCode string }
	}
	if e := json.Unmarshal(fixture(t, "chess960.json"), &cases); e != nil {
		t.Fatal(e)
	}
	for _, test := range cases.Accepted {
		t.Run(test.ID, func(t *testing.T) {
			source := c.Text("[Variant \"Chess960\"]\n[SetUp \"1\"]\n[FEN \"" + test.FEN + "\"]\n\n" + test.Moves + " *")
			s, f := compiler.Compile(map[string]c.Text{"file:///test.pgn": source})
			if f != nil {
				t.Fatal(f)
			}
			r := s.Games[0].Result
			if !r.OK {
				t.Fatal(r.Error)
			}
			frame := r.Value.Frames[1]
			if frame.FEN != test.ExpectedFen || *frame.UCI != test.ExpectedUci {
				t.Fatal(frame, test.ExpectedFen, test.ExpectedUci)
			}
		})
	}
	for _, test := range cases.Rejected {
		s, _ := compiler.Compile(map[string]c.Text{"file:///test.pgn": c.Text("[Variant \"Chess960\"]\n[FEN \"" + test.FEN + "\"]\n\n" + test.Moves + " *")})
		if s.Games[0].Result.OK || s.Games[0].Result.Error.Code != test.ExpectedCode {
			t.Fatal(test.ID, s.Games)
		}
	}
}
func TestEveryBranch(t *testing.T) {
	for _, pgn := range []string{"1. e4 e5 (1... e6 2. Qh4) *", `[Variant "Chess960"]`} {
		s, f := compiler.Compile(map[string]c.Text{"file:///bad.pgn": c.Text(pgn)})
		if f != nil {
			t.Fatal(f)
		}
		if s.Games[0].Result.OK {
			t.Fatal("invalid game accepted")
		}
	}
}
func FuzzDecode(f *testing.F) {
	f.Add("module demo;")
	f.Add("module x; story s {")
	f.Add("\ufeffmodule x; //\r\n")
	f.Fuzz(func(t *testing.T, source string) {
		d, e := compiler.Decode(c.Text(source))
		if e != nil {
			return
		}
		raw, _ := json.Marshal(d)
		printed, e := compiler.PrintStructured(raw)
		if e != nil {
			t.Fatal(e)
		}
		again, e := compiler.Decode(printed)
		if e != nil {
			t.Fatal(e)
		}
		back, _ := json.Marshal(again)
		if string(raw) != string(back) {
			t.Fatal("model changed")
		}
	})
}

func TestAll960Arrays(t *testing.T) {
	ranks := []string{}
	var visit func(string, string)
	visit = func(prefix, rest string) {
		if rest == "" {
			a, b := strings.Index(prefix, "B"), strings.LastIndex(prefix, "B")
			k := strings.Index(prefix, "K")
			if a%2 != b%2 && strings.Index(prefix, "R") < k && k < strings.LastIndex(prefix, "R") {
				ranks = append(ranks, prefix)
			}
			return
		}
		used := map[byte]bool{}
		for i := 0; i < len(rest); i++ {
			if !used[rest[i]] {
				used[rest[i]] = true
				visit(prefix+rest[i:i+1], rest[:i]+rest[i+1:])
			}
		}
	}
	visit("", "BBKNNQRR")
	if len(ranks) != 960 {
		t.Fatal(len(ranks))
	}
	sources := map[string]c.Text{}
	for _, rank := range ranks {
		fen := strings.ToLower(rank) + "/pppppppp/8/8/8/8/PPPPPPPP/" + rank + " w KQkq - 0 1"
		sources["file:///"+rank+".pgn"] = c.Text("[Variant \"Chess960\"]\n[FEN \"" + fen + "\"]\n\n*")
	}
	s, f := compiler.Compile(sources)
	if f != nil {
		t.Fatal(f)
	}
	if len(s.Games) != 960 {
		t.Fatal(len(s.Games))
	}
	for _, g := range s.Games {
		if !g.Result.OK {
			t.Fatal(g.URI, g.Result.Error)
		}
		rank := strings.TrimSuffix(strings.TrimPrefix(g.URI, "file:///"), ".pgn")
		want := strings.ToLower(rank) + "/pppppppp/8/8/8/8/PPPPPPPP/" + rank + " w KQkq - 0 1"
		if g.Result.Value.Frames[0].FEN != want {
			t.Fatal(rank, g.Result.Value.Frames[0].FEN)
		}
	}
}
func FuzzPGN(f *testing.F) {
	f.Add("1. e4 e5 (1... e6 2. Qh4) *")
	f.Add("[FEN \"invalid\"]\n*")
	f.Fuzz(func(t *testing.T, pgn string) {
		s, e := compiler.Compile(map[string]c.Text{"file:///fuzz.pgn": c.Text(pgn)})
		if e != nil {
			t.Fatal(e)
		}
		if len(s.Games) != 1 {
			t.Fatal("missing result")
		}
	})
}

func TestReadViewsDoNotAliasSnapshot(t *testing.T) {
	sources := map[string]c.Text{"file:///g.pgn": "1. e4 *", "file:///s.chess-story": `module m; game g from "./g.pgn"; story s {board b game g after 0 {prompt "Play." answer "e4";}}`}
	snapshot, f := compiler.Compile(sources)
	if f != nil {
		t.Fatal(f)
	}
	plan, f := compiler.CreatePlaybackPlan(snapshot, "file:///s.chess-story", "s")
	if f != nil {
		t.Fatal(f)
	}
	*plan.Scenes[0].Frames[1].SAN = "mutated"
	frame, f := compiler.SelectPosition(snapshot, "file:///g.pgn", 1)
	if f != nil || *frame.SAN != "e4" {
		t.Fatal("plan aliases snapshot")
	}
	*frame.SAN = "changed"
	again, _ := compiler.SelectPosition(snapshot, "file:///g.pgn", 1)
	if *again.SAN != "e4" {
		t.Fatal("selection aliases snapshot")
	}
}
func TestEnvelopeRejectsUnknownVersionField(t *testing.T) {
	d, f := compiler.Decode("module m;")
	if f != nil {
		t.Fatal(f)
	}
	raw, _ := json.Marshal(compiler.Envelope(d, "module m;"))
	raw = []byte(strings.Replace(string(raw), `"version":0`, `"unknown":0`, 1))
	if _, f := compiler.Restore(raw); f == nil {
		t.Fatal("unknown envelope key accepted")
	}
}

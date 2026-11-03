// Package parsing adapts Fastbelt syntax into the compiler-owned authored IR.
package parsing

import (
	"fmt"
	"strconv"
	"strings"

	c "github.com/phibkro/chess-anthology/compiler/contracts"
	gen "github.com/phibkro/chess-anthology/compiler/internal/phases/100-parsing/generated"
	core "typefox.dev/fastbelt"
	"typefox.dev/fastbelt/lexer"
	"typefox.dev/fastbelt/parser"
	"typefox.dev/fastbelt/util/service"
)

//go:generate go tool fastbelt generate narrative.fb -o generated

type Syntax struct {
	Data        *c.Document
	Spans       map[string]c.Range
	Diagnostics []c.Diagnostic
}

func Path(parts ...any) string {
	s := []string{}
	for _, p := range parts {
		s = append(s, fmt.Sprint(p))
	}
	return strings.Join(s, ".")
}
func Position(source c.Text, offset int) c.Position {
	if offset < 0 {
		offset = 0
	}
	if offset > len(source) {
		offset = len(source)
	}
	line, last := 0, 0
	for i := 0; i < offset; i++ {
		if source[i] == '\r' {
			if i+1 < len(source) && source[i+1] == '\n' {
				if i+1 >= offset {
					break
				}
				i++
			}
			line++
			last = i + 1
		} else if source[i] == '\n' {
			line++
			last = i + 1
		}
	}
	return c.Position{Line: line, Character: c.Text(string(source)[last:offset]).Units()}
}
func Range(source c.Text, start, end int) c.Range {
	return c.Range{Start: Position(source, start), End: Position(source, end)}
}
func diagnostic(code, message string, span c.Range) c.Diagnostic {
	stage := "syntax"
	if code == "lexing-error" {
		stage = "lexical"
	}
	return c.Diagnostic{Code: code, Message: message, Range: span, Phase: "100-parsing", Stage: stage, Severity: 1}
}
func Parse(source c.Text) Syntax {
	out := Syntax{Spans: map[string]c.Range{}, Diagnostics: []c.Diagnostic{}}
	sc := service.NewContainer()
	gen.SetupGeneratedServices(sc)
	sc.Seal()
	doc := core.NewDocumentFromString("file:///parse.chess-story", "narrative", string(source))
	service.MustGet[lexer.Lexer](sc).Exec(doc)
	for _, e := range doc.LexerErrors {
		out.Diagnostics = append(out.Diagnostics, diagnostic("lexing-error", e.Msg, Range(source, int(e.Range.Start), int(e.Range.End))))
	}
	if len(out.Diagnostics) > 0 {
		return out
	}
	service.MustGet[parser.Parser](sc).Parse(doc)
	for _, e := range doc.ParserErrors {
		span := Range(source, len(source), len(source))
		if e.Token != nil {
			span = Range(source, int(e.Token.Range.Start), int(e.Token.Range.End))
		}
		out.Diagnostics = append(out.Diagnostics, diagnostic("parsing-error", e.Msg, span))
	}
	if len(out.Diagnostics) > 0 {
		return out
	}
	module, ok := doc.Root.(gen.Module)
	if !ok {
		out.Diagnostics = append(out.Diagnostics, diagnostic("parsing-error", "Module is unavailable.", Range(source, 0, len(source))))
		return out
	}
	span := func(path string, t *core.Token) {
		if t != nil {
			out.Spans[path] = Range(source, int(t.Range.Start), int(t.Range.End))
		}
	}
	unquote := func(t *core.Token) c.Text {
		if t == nil {
			return ""
		}
		var value c.Text
		if e := value.UnmarshalJSON([]byte(t.Image)); e != nil {
			out.Diagnostics = append(out.Diagnostics, diagnostic("lexing-error", e.Error(), Range(source, int(t.Range.Start), int(t.Range.End))))
		}
		return value
	}
	d := c.Document{Name: module.Name(), Imports: []c.Text{}, Games: []c.Game{}, Stories: []c.Story{}}
	span("name", module.NameToken())
	for i, im := range module.Imports() {
		span(Path("imports", i), im.PathToken())
		d.Imports = append(d.Imports, unquote(im.PathToken()))
	}
	for _, declaration := range module.Declarations() {
		switch item := declaration.(type) {
		case gen.Game:
			base := Path("games", len(d.Games))
			span(base+".name", item.NameToken())
			span(base+".source", item.PathToken())
			d.Games = append(d.Games, c.Game{Exported: item.IsExported(), Name: item.Name(), Source: unquote(item.PathToken())})
		case gen.Story:
			si := len(d.Stories)
			span(Path("stories", si, "name"), item.NameToken())
			story := c.Story{Name: item.Name(), Scenes: []c.Scene{}}
			for bi, b := range item.Scenes() {
				base := Path("stories", si, "scenes", bi)
				span(base+".name", b.NameToken())
				span(base+".game", b.GameToken())
				span(base+".ply", b.PlyToken())
				ply, e := strconv.ParseInt(b.Ply(), 10, 64)
				if e != nil || ply > 9007199254740991 {
					ply = 9007199254740992
				}
				scene := c.Scene{Name: b.Name(), Game: b.Game(), Ply: c.Integer(ply), Notes: []c.Note{}}
				for ni, n := range b.Notes() {
					np := Path(base, "notes", ni)
					switch note := n.(type) {
					case gen.TextNote:
						span(np+".text", note.ContentToken())
						scene.Notes = append(scene.Notes, c.Note{Type: "text", Text: unquote(note.ContentToken())})
					case gen.ArrowNote:
						span(np+".from", note.FromToken())
						span(np+".to", note.ToToken())
						span(np+".color", note.ColorToken())
						scene.Notes = append(scene.Notes, c.Note{Type: "arrow", From: unquote(note.FromToken()), To: unquote(note.ToToken()), Color: note.Color()})
					case gen.PromptNote:
						span(np+".text", note.ContentToken())
						span(np+".answer", note.AnswerToken())
						scene.Notes = append(scene.Notes, c.Note{Type: "prompt", Text: unquote(note.ContentToken()), Answer: unquote(note.AnswerToken())})
					}
				}
				story.Scenes = append(story.Scenes, scene)
			}
			d.Stories = append(d.Stories, story)
		}
	}
	if len(out.Diagnostics) > 0 {
		return out
	}
	out.Data = &d
	return out
}

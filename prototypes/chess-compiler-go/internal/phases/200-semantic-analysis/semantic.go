// Package semantic validates the authored IR independently of source parsing.
package semantic

import (
	"encoding/json"
	"fmt"
	"reflect"
	"regexp"
	"strings"

	c "github.com/phibkro/chess-anthology/compiler/contracts"
)

var id = regexp.MustCompile(`^[_a-zA-Z][_a-zA-Z0-9]*$`)
var reserved = map[string]bool{"module": true, "import": true, "export": true, "game": true, "from": true, "story": true, "board": true, "after": true, "text": true, "arrow": true, "prompt": true, "answer": true}

func Identifier(s string) bool { return id.MatchString(s) && !reserved[s] }
func Validate(d c.Document) *c.Failure {
	bad := func() *c.Failure { return c.Fail("schema", "document/invalid-shape", "Invalid structured document.") }
	if d.FormatVersion != 0 || !Identifier(d.Name) || d.Imports == nil || d.Games == nil || d.Stories == nil {
		return bad()
	}
	for _, g := range d.Games {
		if !Identifier(g.Name) {
			return bad()
		}
	}
	for _, s := range d.Stories {
		if !Identifier(s.Name) || s.Scenes == nil {
			return bad()
		}
		for _, sc := range s.Scenes {
			if !Identifier(sc.Name) || !Identifier(sc.Game) || sc.Ply < 0 || sc.Ply > 9007199254740991 || sc.Notes == nil {
				return bad()
			}
			for _, n := range sc.Notes {
				if n.AnswerUCI != "" {
					return bad()
				}
				switch n.Type {
				case "text", "prompt":
				case "arrow":
					if !Identifier(n.Color) {
						return bad()
					}
				default:
					return bad()
				}
			}
		}
	}
	return nil
}

// Shape rejects unknown/missing fields and null before Go's zero values obscure them.
func shape(raw json.RawMessage, t reflect.Type) error {
	if t == reflect.TypeFor[c.Text]() || t == reflect.TypeFor[c.Integer]() {
		if string(raw) == "null" {
			return fmt.Errorf("null primitive")
		}
		return nil
	}
	if t == reflect.TypeFor[c.Note]() {
		var m map[string]json.RawMessage
		if e := json.Unmarshal(raw, &m); e != nil {
			return e
		}
		var typ string
		if e := json.Unmarshal(m["type"], &typ); e != nil {
			return e
		}
		keys := []string{"type", "text"}
		if typ == "arrow" {
			keys = []string{"type", "from", "to", "color"}
		} else if typ == "prompt" {
			keys = append(keys, "answer")
		} else if typ != "text" {
			return fmt.Errorf("note type")
		}
		if len(m) != len(keys) {
			return fmt.Errorf("note shape")
		}
		for _, k := range keys {
			if len(m[k]) == 0 || string(m[k]) == "null" {
				return fmt.Errorf("missing note field")
			}
		}
		return nil
	}
	switch t.Kind() {
	case reflect.Struct:
		var m map[string]json.RawMessage
		if e := json.Unmarshal(raw, &m); e != nil {
			return e
		}
		if len(m) != t.NumField() {
			return fmt.Errorf("unknown/missing fields")
		}
		for i := 0; i < t.NumField(); i++ {
			f := t.Field(i)
			name := strings.Split(f.Tag.Get("json"), ",")[0]
			if len(m[name]) == 0 || string(m[name]) == "null" {
				return fmt.Errorf("missing %s", name)
			}
			if e := shape(m[name], f.Type); e != nil {
				return e
			}
		}
	case reflect.Slice:
		if string(raw) == "null" {
			return fmt.Errorf("null array")
		}
		var items []json.RawMessage
		if e := json.Unmarshal(raw, &items); e != nil {
			return e
		}
		for _, item := range items {
			if e := shape(item, t.Elem()); e != nil {
				return e
			}
		}
	}
	return nil
}
func ParseStructured(raw []byte) (c.Document, *c.Failure) {
	var d c.Document
	if !json.Valid(raw) || shape(raw, reflect.TypeFor[c.Document]()) != nil || json.Unmarshal(raw, &d) != nil {
		return d, c.Fail("schema", "document/invalid-shape", "Invalid structured document.")
	}
	return d, Validate(d)
}

type Issue struct {
	Code    string
	Message string
	Path    string
}

func Analyze(d c.Document) []Issue {
	out := []Issue{}
	seen := map[string]bool{}
	for i, g := range d.Games {
		if seen[g.Name] {
			out = append(out, Issue{"semantic/duplicate-symbol", "Duplicate declaration " + g.Name + ".", fmt.Sprintf("games.%d.name", i)})
		}
		seen[g.Name] = true
	}
	for i, s := range d.Stories {
		if seen[s.Name] {
			out = append(out, Issue{"semantic/duplicate-symbol", "Duplicate declaration " + s.Name + ".", fmt.Sprintf("stories.%d.name", i)})
		}
		seen[s.Name] = true
		boards := map[string]bool{}
		for j, b := range s.Scenes {
			if boards[b.Name] {
				out = append(out, Issue{"semantic/duplicate-occurrence", "Duplicate board occurrence " + b.Name + ".", fmt.Sprintf("stories.%d.scenes.%d.name", i, j)})
			}
			boards[b.Name] = true
		}
	}
	return out
}

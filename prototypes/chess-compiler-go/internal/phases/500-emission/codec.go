// Package emission projects analyzed sources into portable output and playback contracts.
package emission

import (
	"encoding/json"
	"strings"

	c "github.com/phibkro/chess-anthology/compiler/contracts"
	parsing "github.com/phibkro/chess-anthology/compiler/internal/phases/100-parsing"
	semantic "github.com/phibkro/chess-anthology/compiler/internal/phases/200-semantic-analysis"
)

func Decode(source c.Text) (c.Document, *c.Failure) {
	p := parsing.Parse(source)
	if len(p.Diagnostics) > 0 {
		return c.Document{}, c.Fail("syntax", "source/invalid-syntax", "Resolve syntax diagnostics.")
	}
	if p.Data == nil {
		return c.Document{}, c.Fail("syntax", "source/invalid-syntax", "Module is unavailable.")
	}
	return *p.Data, semantic.Validate(*p.Data)
}
func quote(t c.Text) string { b, _ := t.MarshalJSON(); return string(b) }
func PrintStructured(raw []byte) (c.Text, *c.Failure) {
	d, f := semantic.ParseStructured(raw)
	if f != nil {
		return "", f
	}
	lines := []string{"module " + d.Name + ";"}
	for _, p := range d.Imports {
		lines = append(lines, "import "+quote(p)+";")
	}
	for _, g := range d.Games {
		prefix := ""
		if g.Exported {
			prefix = "export "
		}
		lines = append(lines, prefix+"game "+g.Name+" from "+quote(g.Source)+";")
	}
	for _, s := range d.Stories {
		boards := []string{}
		for _, sc := range s.Scenes {
			notes := []string{}
			for _, n := range sc.Notes {
				switch n.Type {
				case "text":
					notes = append(notes, "    text "+quote(n.Text)+";")
				case "arrow":
					notes = append(notes, "    arrow "+quote(n.From)+" -> "+quote(n.To)+" "+n.Color+";")
				case "prompt":
					notes = append(notes, "    prompt "+quote(n.Text)+" answer "+quote(n.Answer)+";")
				}
			}
			ply, _ := json.Marshal(sc.Ply)
			boards = append(boards, "  board "+sc.Name+" game "+sc.Game+" after "+string(ply)+" {\n"+strings.Join(notes, "\n")+"\n  }")
		}
		lines = append(lines, "story "+s.Name+" {\n"+strings.Join(boards, "\n")+"\n}")
	}
	return c.Text(strings.Join(append(lines, ""), "\n")), nil
}
func Envelope(d c.Document, source c.Text) c.Envelope {
	return c.Envelope{Data: d, Digest: c.Digest(source), Format: "chess-source-envelope-prototype", SourceText: source, Version: 0}
}
func Restore(raw []byte) (c.Text, *c.Failure) {
	var e c.Envelope
	var keys map[string]json.RawMessage
	expected := []string{"data", "digest", "format", "sourceText", "version"}
	if json.Unmarshal(raw, &keys) != nil || len(keys) != 5 || json.Unmarshal(raw, &e) != nil || e.Format != "chess-source-envelope-prototype" || e.Version != 0 || e.Digest != c.Digest(e.SourceText) {
		return "", c.Fail("integrity", "codec/invalid-envelope", "Unsupported or modified source envelope.")
	}
	for _, key := range expected {
		if _, exists := keys[key]; !exists {
			return "", c.Fail("integrity", "codec/invalid-envelope", "Unsupported or modified source envelope.")
		}
	}
	d, f := semantic.ParseStructured(keys["data"])
	if f != nil {
		return "", f
	}
	parsed, f := Decode(e.SourceText)
	if f != nil {
		return "", f
	}
	a, _ := json.Marshal(parsed)
	b, _ := json.Marshal(d)
	if string(a) != string(b) {
		return "", c.Fail("integrity", "codec/stale-source", "Source and structured data disagree.")
	}
	return e.SourceText, nil
}

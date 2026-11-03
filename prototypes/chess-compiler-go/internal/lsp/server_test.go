package lsp

import (
	"context"
	"encoding/json"
	c "github.com/phibkro/chess-anthology/compiler/contracts"
	"golang.org/x/exp/jsonrpc2"
	"strings"
	"testing"
)

func TestUTF16Edits(t *testing.T) {
	original := c.Text("a😀b\r\nc")
	got, e := apply(original, []change{{Range: &c.Range{Start: c.Position{Line: 0, Character: 2}, End: c.Position{Line: 0, Character: 3}}, Text: "x"}})
	if e != nil {
		t.Fatal(e)
	}
	raw, e := json.Marshal(got)
	if e != nil || string(raw) != `"a\ud83dxb\r\nc"` {
		t.Fatalf("lost surrogate: %s %v", raw, e)
	}
	next, e := apply(original, []change{{Range: &c.Range{Start: c.Position{Line: 1, Character: 0}, End: c.Position{Line: 1, Character: 1}}, Text: "end"}})
	if e != nil || next != "a😀b\r\nend" {
		t.Fatalf("CRLF: %q %v", next, e)
	}
	_, e = apply(original, []change{{Range: &c.Range{Start: c.Position{Line: 0, Character: 99}, End: c.Position{Line: 0, Character: 100}}, Text: "x"}})
	if e == nil {
		t.Fatal("out-of-bounds edit accepted")
	}
}

func FuzzUTF16Edit(f *testing.F) {
	f.Add("a😀b\r\nc", uint16(2))
	f.Fuzz(func(t *testing.T, text string, cut uint16) {
		original := c.FromUTF16(c.Text(strings.NewReplacer("\r", " ", "\n", " ").Replace(text)).UTF16())
		units := original.UTF16()
		a, b := int(cut)%(len(units)+1), (int(cut)/7)%(len(units)+1)
		if a > b {
			a, b = b, a
		}
		edited, e := apply(original, []change{{Range: &c.Range{Start: c.Position{Character: a}, End: c.Position{Character: b}}, Text: "♟😀"}})
		if e != nil {
			t.Fatal(e)
		}
		restored, e := apply(edited, []change{{Range: &c.Range{Start: c.Position{Character: a}, End: c.Position{Character: a + 3}}, Text: c.FromUTF16(units[a:b])}})
		if e != nil || restored != original {
			t.Fatalf("edit/restore lost code units: %v", e)
		}
	})
}

func TestQueuedCancellationUsesLSPCode(t *testing.T) {
	s := &server{pending: map[jsonrpc2.ID]bool{}, initialized: true}
	request := &jsonrpc2.Request{ID: jsonrpc2.Int64ID(42), Method: "textDocument/definition", Params: json.RawMessage(`{"textDocument":{"uri":"file:///missing.chess-story"},"position":{"line":0,"character":0}}`)}
	_, _ = s.Preempt(context.Background(), request)
	_, e := s.Preempt(context.Background(), &jsonrpc2.Request{Method: "$/cancelRequest", Params: json.RawMessage(`{"id":42}`)})
	if e != nil {
		t.Fatal(e)
	}
	_, e = s.Handle(context.Background(), request)
	raw, _ := json.Marshal(e)
	if !strings.Contains(string(raw), `"code":-32800`) {
		t.Fatalf("unexpected cancellation: %s", raw)
	}
	if len(s.pending) != 0 {
		t.Fatal("completed request ID retained")
	}
	_, _ = s.Preempt(context.Background(), &jsonrpc2.Request{Method: "$/cancelRequest", Params: json.RawMessage(`{"id":42}`)})
	if len(s.pending) != 0 {
		t.Fatal("late cancellation retained")
	}
}

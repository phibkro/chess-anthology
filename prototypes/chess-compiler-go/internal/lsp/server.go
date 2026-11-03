// Package lsp adapts the public compiler to a serialized UTF-16 LSP workspace.
package lsp

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	compiler "github.com/phibkro/chess-anthology/compiler"
	c "github.com/phibkro/chess-anthology/compiler/contracts"
	"golang.org/x/exp/jsonrpc2"
	protocol "typefox.dev/lsp"
)

type buffer struct {
	text    c.Text
	version int
}
type dependencyEntry struct {
	source c.Text
	paths  []string
}
type server struct {
	dependencies map[string]dependencyEntry
	pendingMu    sync.Mutex
	pending      map[jsonrpc2.ID]bool

	conn                  *jsonrpc2.Connection
	compiler              *compiler.Compiler
	sources               map[string]c.Text
	open                  map[string]buffer
	snapshot              c.Snapshot
	initialized, shutdown bool
	watch                 bool
	done                  chan struct{}
}
type transport struct{ io.ReadWriteCloser }

func (t transport) Dial(context.Context) (io.ReadWriteCloser, error) { return t.ReadWriteCloser, nil }
func (s *server) Bind(_ context.Context, conn *jsonrpc2.Connection) (jsonrpc2.ConnectionOptions, error) {
	s.conn = conn
	return jsonrpc2.ConnectionOptions{Handler: s, Preempter: s}, nil
}
func (s *server) Preempt(_ context.Context, r *jsonrpc2.Request) (any, error) {
	s.pendingMu.Lock()
	defer s.pendingMu.Unlock()
	if r.Method != "$/cancelRequest" {
		if r.ID.IsValid() {
			s.pending[r.ID] = false
		}
		return nil, jsonrpc2.ErrNotHandled
	}
	var p struct {
		ID json.RawMessage `json:"id"`
	}
	if json.Unmarshal(r.Params, &p) != nil {
		return nil, jsonrpc2.NewError(-32602, "Invalid cancellation")
	}
	var id jsonrpc2.ID
	var n int64
	if json.Unmarshal(p.ID, &n) == nil {
		id = jsonrpc2.Int64ID(n)
	} else {
		var v string
		if json.Unmarshal(p.ID, &v) == nil {
			id = jsonrpc2.StringID(v)
		}
	}
	if _, ok := s.pending[id]; ok {
		s.pending[id] = true
	}
	return nil, nil
}

// Serve owns one stdio connection. Requests are serialized; cancellation bypasses the queue.
func Serve(ctx context.Context, stream io.ReadWriteCloser) error {
	s := &server{dependencies: map[string]dependencyEntry{}, pending: map[jsonrpc2.ID]bool{}, compiler: compiler.CreateCompiler(), sources: map[string]c.Text{}, open: map[string]buffer{}, done: make(chan struct{})}
	conn, e := jsonrpc2.Dial(ctx, transport{stream}, s)
	if e != nil {
		return e
	}
	ended := make(chan error, 1)
	go func() { ended <- conn.Wait() }()
	select {
	case <-s.done:
		e = conn.Close()
		if !s.shutdown {
			return fmt.Errorf("exit before shutdown")
		}
		return e
	case e = <-ended:
		select {
		case <-s.done:
			if s.shutdown {
				return nil
			}
			return fmt.Errorf("exit before shutdown")
		default:
			return e
		}
	case <-ctx.Done():
		_ = conn.Close()
		return ctx.Err()
	}
}
func path(uri string) (string, error) {
	u, e := url.Parse(uri)
	if e != nil || u.Scheme != "file" || u.Host != "" && u.Host != "localhost" {
		return "", fmt.Errorf("expected local file URI")
	}
	return filepath.FromSlash(u.Path), nil
}
func fileURI(p string) string { return (&url.URL{Scheme: "file", Path: filepath.ToSlash(p)}).String() }
func (s *server) load(uri string) {
	if b, ok := s.open[uri]; ok {
		s.sources[uri] = b.text
		return
	}
	p, e := path(uri)
	if e == nil {
		var raw []byte
		raw, e = os.ReadFile(p)
		if e == nil {
			s.sources[uri] = c.Text(raw)
			return
		}
	}
	delete(s.sources, uri)
}
func (s *server) discover(root string) error {
	p, e := path(root)
	if e != nil {
		return e
	}
	return filepath.WalkDir(p, func(p string, d fs.DirEntry, e error) error {
		if e != nil {
			return e
		}
		if d.IsDir() {
			switch d.Name() {
			case ".git", "node_modules", "report", "dist", ".tools":
				return filepath.SkipDir
			}
			return nil
		}
		if strings.HasSuffix(p, ".chess-story") {
			s.load(fileURI(p))
		}
		return nil
	})
}
func (s *server) build(ctx context.Context) error {
	for uri := range s.dependencies {
		if _, present := s.sources[uri]; !present {
			delete(s.dependencies, uri)
		}
	}
	visited := map[string]bool{}
	var acquire func(string)
	acquire = func(uri string) {
		if visited[uri] {
			return
		}
		visited[uri] = true
		text, ok := s.sources[uri]
		if !ok || !strings.HasSuffix(uri, ".chess-story") {
			return
		}
		entry, cached := s.dependencies[uri]
		if !cached || entry.source != text {
			entry = dependencyEntry{source: text}
			if d, f := compiler.Decode(text); f == nil {
				for _, p := range d.Imports {
					entry.paths = append(entry.paths, compiler.ResolveSourceURI(uri, p))
				}
				for _, g := range d.Games {
					entry.paths = append(entry.paths, compiler.ResolveSourceURI(uri, g.Source))
				}
			}
			s.dependencies[uri] = entry
		}
		for _, dep := range entry.paths {
			if _, present := s.sources[dep]; !present {
				s.load(dep)
			}
			acquire(dep)
		}
	}
	for uri := range s.sources {
		acquire(uri)
	}
	u, f := s.compiler.Update(s.sources)
	if f != nil {
		return f
	}
	previous := s.snapshot
	s.snapshot = u.Snapshot
	present := map[string]bool{}
	for _, o := range s.snapshot.Output {
		present[o.URI] = true
	}
	for _, o := range previous.Output {
		if !present[o.URI] {
			if e := s.conn.Notify(ctx, "textDocument/publishDiagnostics", map[string]any{"uri": o.URI, "diagnostics": []any{}}); e != nil {
				return e
			}
		}
	}
	for _, o := range s.snapshot.Output {
		params := map[string]any{"uri": o.URI, "diagnostics": o.Diagnostics}
		if b, ok := s.open[o.URI]; ok {
			params["version"] = b.version
		}
		if e := s.conn.Notify(ctx, "textDocument/publishDiagnostics", params); e != nil {
			return e
		}
	}
	return nil
}

type docID struct {
	URI     string `json:"uri"`
	Version int    `json:"version"`
}
type change struct {
	Range *c.Range `json:"range"`
	Text  c.Text   `json:"text"`
}

func offset(units []uint16, p c.Position) (int, error) {
	if p.Line < 0 || p.Character < 0 {
		return 0, fmt.Errorf("negative position")
	}
	i, line := 0, 0
	for i < len(units) && line < p.Line {
		if units[i] == '\r' {
			i++
			if i < len(units) && units[i] == '\n' {
				i++
			}
			line++
		} else if units[i] == '\n' {
			i++
			line++
		} else {
			i++
		}
	}
	if line != p.Line {
		return 0, fmt.Errorf("line out of bounds")
	}
	end := i
	for end < len(units) && units[end] != '\n' && units[end] != '\r' {
		end++
	}
	if p.Character > end-i {
		return 0, fmt.Errorf("column out of bounds")
	}
	return i + p.Character, nil
}
func apply(text c.Text, changes []change) (c.Text, error) {
	for _, v := range changes {
		if v.Range == nil {
			text = v.Text
			continue
		}
		u := text.UTF16()
		a, e := offset(u, v.Range.Start)
		if e != nil {
			return text, e
		}
		b, e := offset(u, v.Range.End)
		if e != nil || b < a {
			return text, fmt.Errorf("invalid edit range")
		}
		next := append([]uint16{}, u[:a]...)
		next = append(next, v.Text.UTF16()...)
		next = append(next, u[b:]...)
		text = c.FromUTF16(next)
	}
	return text, nil
}
func inside(p c.Position, r c.Range) bool {
	return (p.Line > r.Start.Line || p.Line == r.Start.Line && p.Character >= r.Start.Character) && (p.Line < r.End.Line || p.Line == r.End.Line && p.Character <= r.End.Character)
}
func (s *server) query(method, uri string, p c.Position) any {
	info, f := s.compiler.Describe(uri)
	if f != nil || info.Data == nil {
		return nil
	}
	for si, story := range info.Data.Stories {
		for bi, scene := range story.Scenes {
			prefix := "stories." + strconv.Itoa(si) + ".scenes." + strconv.Itoa(bi)
			if method == "textDocument/definition" && inside(p, info.Spans[prefix+".game"]) {
				locations := []any{}
				visit := func(u string, d *c.Document, spans map[string]c.Range, export bool) {
					for i, g := range d.Games {
						if g.Name == scene.Game && (!export || g.Exported) {
							locations = append(locations, map[string]any{"uri": u, "range": spans["games."+strconv.Itoa(i)+".name"]})
						}
					}
				}
				visit(uri, info.Data, info.Spans, false)
				if len(locations) == 0 {
					for _, imp := range info.Data.Imports {
						target := compiler.ResolveSourceURI(uri, imp)
						other, e := s.compiler.Describe(target)
						if e == nil && other.Data != nil {
							visit(target, other.Data, other.Spans, true)
						}
					}
				}
				return locations
			}
			if method == "textDocument/completion" {
				for ni, n := range scene.Notes {
					if n.Type != "prompt" {
						continue
					}
					r, ok := info.Spans[prefix+".notes."+strconv.Itoa(ni)+".answer"]
					if !ok || !inside(p, r) {
						continue
					}
					r.Start.Character++
					r.End.Character--
					items := []any{}
					for _, o := range s.snapshot.Output {
						if o.URI != uri {
							continue
						}
						for _, occ := range o.Occurrences {
							if occ.ID != uri+"#"+story.Name+"/"+scene.Name {
								continue
							}
							for _, m := range occ.LegalMoves {
								items = append(items, map[string]any{"label": m.SAN, "detail": m.UCI, "textEdit": map[string]any{"range": r, "newText": m.SAN}})
							}
						}
					}
					return map[string]any{"isIncomplete": false, "items": items}
				}
			}
		}
	}
	if method == "textDocument/completion" {
		return map[string]any{"isIncomplete": false, "items": []any{}}
	}
	return nil
}
func (s *server) Handle(ctx context.Context, r *jsonrpc2.Request) (any, error) {
	s.pendingMu.Lock()
	cancelled := s.pending[r.ID]
	s.pendingMu.Unlock()
	defer func() { s.pendingMu.Lock(); delete(s.pending, r.ID); s.pendingMu.Unlock() }()
	if cancelled {
		return nil, jsonrpc2.NewError(-32800, "Request cancelled")
	}

	if ctx.Err() != nil {
		return nil, jsonrpc2.NewError(-32800, "Request cancelled")
	}
	if r.Method == "exit" {
		select {
		case <-s.done:
		default:
			close(s.done)
		}
		return nil, nil
	}
	if r.Method == "initialize" {
		if s.initialized {
			return nil, jsonrpc2.NewError(-32600, "Already initialized")
		}
		var p struct {
			RootURI          string `json:"rootUri"`
			WorkspaceFolders []struct {
				URI string `json:"uri"`
			} `json:"workspaceFolders"`
		}
		if json.Unmarshal(r.Params, &p) != nil {
			return nil, jsonrpc2.NewError(-32602, "Invalid initialize parameters")
		}
		roots := []string{}
		for _, w := range p.WorkspaceFolders {
			roots = append(roots, w.URI)
		}
		if len(roots) == 0 && p.RootURI != "" {
			roots = append(roots, p.RootURI)
		}
		for _, root := range roots {
			if e := s.discover(root); e != nil {
				return nil, jsonrpc2.NewError(-32602, e.Error())
			}
		}
		var capabilities protocol.InitializeParams
		if json.Unmarshal(r.Params, &capabilities) == nil {
			s.watch = capabilities.Capabilities.Workspace.DidChangeWatchedFiles.DynamicRegistration
		}
		s.initialized = true
		return map[string]any{"capabilities": map[string]any{"positionEncoding": "utf-16", "textDocumentSync": map[string]any{"openClose": true, "change": 2, "save": true}, "completionProvider": map[string]any{}, "definitionProvider": true}, "serverInfo": map[string]any{"name": "chess-narrative-go", "version": "0.1.0"}}, nil
	}
	if !s.initialized {
		return nil, jsonrpc2.NewError(-32002, "Server not initialized")
	}
	if s.shutdown {
		return nil, jsonrpc2.NewError(-32600, "Server shut down")
	}
	switch r.Method {
	case "initialized":
		if s.watch {
			registration := map[string]any{"registrations": []any{map[string]any{"id": "chess-artifacts", "method": "workspace/didChangeWatchedFiles", "registerOptions": map[string]any{"watchers": []any{map[string]any{"globPattern": "**/*.chess-story"}, map[string]any{"globPattern": "**/*.pgn"}}}}}}
			deadline, cancel := context.WithTimeout(ctx, 3*time.Second)
			defer cancel()
			var result any
			if e := s.conn.Call(deadline, "client/registerCapability", registration).Await(deadline, &result); e != nil {
				return nil, e
			}
		}
		return nil, nil
	case "shutdown":
		s.shutdown = true
		return json.RawMessage("null"), nil
	case "textDocument/didOpen":
		var p struct {
			TextDocument struct {
				URI     string `json:"uri"`
				Version int    `json:"version"`
				Text    c.Text `json:"text"`
			} `json:"textDocument"`
		}
		if e := json.Unmarshal(r.Params, &p); e != nil || p.TextDocument.URI == "" {
			return nil, jsonrpc2.NewError(-32602, "Invalid document")
		}
		d := p.TextDocument
		s.open[d.URI] = buffer{d.Text, d.Version}
		s.sources[d.URI] = d.Text
		return nil, s.build(ctx)
	case "textDocument/didChange":
		var p struct {
			TextDocument   docID    `json:"textDocument"`
			ContentChanges []change `json:"contentChanges"`
		}
		if json.Unmarshal(r.Params, &p) != nil {
			return nil, jsonrpc2.NewError(-32602, "Invalid change")
		}
		b, ok := s.open[p.TextDocument.URI]
		if !ok || p.TextDocument.Version <= b.version {
			return nil, nil
		}
		text, e := apply(b.text, p.ContentChanges)
		if e != nil {
			return nil, jsonrpc2.NewError(-32602, e.Error())
		}
		s.open[p.TextDocument.URI] = buffer{text, p.TextDocument.Version}
		s.sources[p.TextDocument.URI] = text
		return nil, s.build(ctx)
	case "textDocument/didClose":
		var p protocol.DidCloseTextDocumentParams
		if json.Unmarshal(r.Params, &p) != nil {
			return nil, jsonrpc2.NewError(-32602, "Invalid close")
		}
		uri := string(p.TextDocument.URI)
		delete(s.open, uri)
		s.load(uri)
		if e := s.conn.Notify(ctx, "textDocument/publishDiagnostics", map[string]any{"uri": uri, "diagnostics": []any{}}); e != nil {
			return nil, e
		}
		return nil, s.build(ctx)
	case "textDocument/didSave":
		return nil, nil
	case "workspace/didChangeWatchedFiles":
		var p protocol.DidChangeWatchedFilesParams
		if json.Unmarshal(r.Params, &p) != nil {
			return nil, jsonrpc2.NewError(-32602, "Invalid watched files")
		}
		for _, v := range p.Changes {
			s.load(string(v.URI))
		}
		return nil, s.build(ctx)
	case "textDocument/completion", "textDocument/definition":
		var p struct {
			TextDocument docID      `json:"textDocument"`
			Position     c.Position `json:"position"`
		}
		if json.Unmarshal(r.Params, &p) != nil || p.TextDocument.URI == "" || p.Position.Line < 0 || p.Position.Character < 0 {
			return nil, jsonrpc2.NewError(-32602, "Invalid position")
		}
		result := s.query(r.Method, p.TextDocument.URI, p.Position)
		if result == nil {
			return json.RawMessage("null"), nil
		}
		return result, nil
	default:
		return nil, jsonrpc2.ErrNotHandled
	}
}

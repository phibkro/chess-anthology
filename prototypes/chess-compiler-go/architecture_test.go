package compiler_test

import (
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestPhaseDependencies(t *testing.T) {
	allowed := map[string]map[string]bool{"100-parsing": {}, "200-semantic-analysis": {}, "300-linking": {}, "400-chess-analysis": {}, "500-emission": {"100-parsing": true, "200-semantic-analysis": true, "300-linking": true, "400-chess-analysis": true}, "600-build": {"100-parsing": true, "300-linking": true, "400-chess-analysis": true, "500-emission": true}}
	e := filepath.WalkDir(".", func(path string, d fs.DirEntry, e error) error {
		if e != nil {
			return e
		}
		if d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		file, e := parser.ParseFile(token.NewFileSet(), path, nil, parser.ImportsOnly)
		if e != nil {
			return e
		}
		normalized := filepath.ToSlash(path)
		parts := strings.Split(normalized, "/")
		owner := ""
		if len(parts) > 2 && parts[0] == "internal" && parts[1] == "phases" {
			owner = parts[2]
		}
		for _, im := range file.Imports {
			target, e := strconv.Unquote(im.Path.Value)
			if e != nil {
				return e
			}
			if strings.HasPrefix(normalized, "contracts/") && (strings.Contains(target, "github.com/") || strings.Contains(target, "typefox.dev/")) {
				t.Errorf("contracts import implementation: %s", path)
			}
			prefix := "github.com/phibkro/chess-anthology/compiler/internal/phases/"
			if strings.HasPrefix(target, prefix) {
				other := strings.Split(strings.TrimPrefix(target, prefix), "/")[0]
				if owner != "" && other != owner && !allowed[owner][other] {
					t.Errorf("%s imports forbidden phase %s", path, other)
				}
				if strings.HasPrefix(normalized, "cmd/") || strings.HasPrefix(normalized, "internal/lsp/") {
					t.Errorf("adapter bypasses public compiler: %s", path)
				}
			}
		}
		return nil
	})
	if e != nil {
		t.Fatal(e)
	}
}

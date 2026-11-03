// Package linking resolves explicit module imports and game visibility.
package linking

import (
	whatwg "github.com/nationallibraryofnorway/whatwg-url/url"
	c "github.com/phibkro/chess-anthology/compiler/contracts"
)

// Relative uses the same WHATWG resolution rules as JavaScript new URL.
func Relative(base string, path c.Text) string {
	value, e := whatwg.ParseRef(c.Text(base).UTF8(), path.UTF8())
	if e != nil {
		return "unresolved:" + encodeComponent(path.UTF8())
	}
	return value.Href(false)
}

// JavaScript encodeURIComponent leaves this ASCII set unescaped on unavailable references.
func encodeComponent(value string) string {
	const hex = "0123456789ABCDEF"
	out := []byte{}
	for _, b := range []byte(value) {
		if b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= '0' && b <= '9' || b == '-' || b == '_' || b == '.' || b == '!' || b == '~' || b == '*' || b == '\'' || b == '(' || b == ')' {
			out = append(out, b)
		} else {
			out = append(out, '%', hex[b>>4], hex[b&15])
		}
	}
	return string(out)
}

type GameRef struct {
	URI  string
	Game c.Game
}

func Visible(uri string, d c.Document, modules map[string]*c.Document) map[string]GameRef {
	out := map[string]GameRef{}
	for i := len(d.Imports) - 1; i >= 0; i-- {
		target := Relative(uri, d.Imports[i])
		if dep := modules[target]; dep != nil {
			for _, g := range dep.Games {
				if g.Exported {
					out[g.Name] = GameRef{target, g}
				}
			}
		}
	}
	for _, g := range d.Games {
		out[g.Name] = GameRef{uri, g}
	}
	return out
}
func Cycle(uri string, modules map[string]*c.Document) bool {
	active := map[string]bool{}
	visited := map[string]bool{}
	var walk func(string) bool
	walk = func(u string) bool {
		if active[u] {
			return true
		}
		if visited[u] {
			return false
		}
		visited[u] = true
		active[u] = true
		if d := modules[u]; d != nil {
			for _, p := range d.Imports {
				if walk(Relative(u, p)) {
					return true
				}
			}
		}
		delete(active, u)
		return false
	}
	return walk(uri)
}

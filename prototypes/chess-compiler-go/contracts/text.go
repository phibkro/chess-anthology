// Package contracts contains versioned data passed between compiler phases.
package contracts

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strconv"
	"unicode/utf8"
)

// Text is a JavaScript string encoded internally as WTF-8, preserving lone UTF-16 surrogates.
// Use JSON methods for interchange and UTF8 for boundaries that replace lone surrogates.
type Text string

func codepoint(s string, i int) (rune, int) {
	if i+2 < len(s) && s[i] == 0xed && s[i+1] >= 0xa0 && s[i+1] <= 0xbf && s[i+2]&0xc0 == 0x80 {
		return rune(s[i]&15)<<12 | rune(s[i+1]&63)<<6 | rune(s[i+2]&63), 3
	}
	return utf8.DecodeRuneInString(s[i:])
}
func appendPoint(out []byte, r rune) []byte {
	if r >= 0xd800 && r <= 0xdfff {
		return append(out, byte(0xe0|r>>12), byte(0x80|(r>>6)&63), byte(0x80|r&63))
	}
	return utf8.AppendRune(out, r)
}

// UTF8 implements the replacement policy of JavaScript TextEncoder.
func (t Text) UTF8() string {
	var b []byte
	for i := 0; i < len(t); {
		r, n := codepoint(string(t), i)
		if r >= 0xd800 && r <= 0xdfff {
			r = utf8.RuneError
		}
		b = utf8.AppendRune(b, r)
		i += n
	}
	return string(b)
}

// Units counts UTF-16 code units rather than Go bytes or runes.
func (t Text) Units() int {
	n := 0
	for i := 0; i < len(t); {
		r, k := codepoint(string(t), i)
		n++
		if r > 0xffff {
			n++
		}
		i += k
	}
	return n
}
func (t Text) MarshalJSON() ([]byte, error) {
	b := []byte{'"'}
	for i := 0; i < len(t); {
		r, n := codepoint(string(t), i)
		i += n
		switch r {
		case '"', '\\':
			b = append(b, '\\', byte(r))
		case '\b':
			b = append(b, '\\', 'b')
		case '\f':
			b = append(b, '\\', 'f')
		case '\n':
			b = append(b, '\\', 'n')
		case '\r':
			b = append(b, '\\', 'r')
		case '\t':
			b = append(b, '\\', 't')
		default:
			if r < 32 || r >= 0xd800 && r <= 0xdfff {
				b = append(b, fmt.Sprintf("\\u%04x", r)...)
			} else {
				b = utf8.AppendRune(b, r)
			}
		}
	}
	return append(b, '"'), nil
}
func (t *Text) UnmarshalJSON(raw []byte) error {
	if !json.Valid(raw) || len(raw) < 2 || raw[0] != '"' {
		return fmt.Errorf("expected JSON string")
	}
	b := []byte{}
	for i := 1; i < len(raw)-1; {
		if raw[i] != '\\' {
			r, n := codepoint(string(raw), i)
			b = appendPoint(b, r)
			i += n
			continue
		}
		i++
		c := raw[i]
		i++
		switch c {
		case '"', '\\', '/':
			b = append(b, c)
		case 'b':
			b = append(b, '\b')
		case 'f':
			b = append(b, '\f')
		case 'n':
			b = append(b, '\n')
		case 'r':
			b = append(b, '\r')
		case 't':
			b = append(b, '\t')
		case 'u':
			x, _ := strconv.ParseUint(string(raw[i:i+4]), 16, 16)
			i += 4
			r := rune(x)
			if r >= 0xd800 && r <= 0xdbff && i+6 <= len(raw)-1 && bytes.Equal(raw[i:i+2], []byte(`\u`)) {
				y, _ := strconv.ParseUint(string(raw[i+2:i+6]), 16, 16)
				if y >= 0xdc00 && y <= 0xdfff {
					r = 0x10000 + (r-0xd800)*1024 + rune(y) - 0xdc00
					i += 6
				}
			}
			b = appendPoint(b, r)
		}
	}
	*t = Text(b)
	return nil
}

// Digest matches SHA-256 over JavaScript's UTF-8 encoding of source text.
func Digest(t Text) string { h := sha256.Sum256([]byte(t.UTF8())); return hex.EncodeToString(h[:]) }

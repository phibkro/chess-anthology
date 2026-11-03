package contracts_test

import (
	"encoding/json"
	"testing"

	c "github.com/phibkro/chess-anthology/compiler/contracts"
)

func TestText(t *testing.T) {
	for _, raw := range []string{`"\ud800"`, `"\udfff"`, `"a\ud800b"`, `"\ud83d\ude00"`, `"é ♞"`, `"\u0000\r\n"`} {
		var x, y c.Text
		if e := json.Unmarshal([]byte(raw), &x); e != nil {
			t.Fatal(e)
		}
		b, e := json.Marshal(x)
		if e != nil {
			t.Fatal(e)
		}
		if e = json.Unmarshal(b, &y); e != nil || x != y {
			t.Fatalf("%s -> %s", raw, b)
		}
	}
	var lone c.Text
	_ = json.Unmarshal([]byte(`"\ud800"`), &lone)
	if lone.Units() != 1 || lone.UTF8() != "�" {
		t.Fatal("UTF16/UTF8 boundary")
	}
}
func FuzzText(f *testing.F) {
	for _, s := range []string{`"\ud800"`, `"a\udfff"`, `"é😀"`, `"\u0000"`} {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, raw string) {
		var v c.Text
		if json.Unmarshal([]byte(raw), &v) != nil {
			return
		}
		b, e := json.Marshal(v)
		if e != nil {
			t.Fatal(e)
		}
		var out c.Text
		if e = json.Unmarshal(b, &out); e != nil || v != out {
			t.Fatal("roundtrip")
		}
	})
}

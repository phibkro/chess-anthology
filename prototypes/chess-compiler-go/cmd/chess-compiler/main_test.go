package main

import (
	"encoding/json"
	c "github.com/phibkro/chess-anthology/compiler/contracts"
	"testing"
)

func TestMalformedHistoryReturnsFailure(t *testing.T) {
	for _, wire := range []string{`{"action":"select","snapshot":{"games":[{"uri":"x","result":{"ok":true}}]},"uri":"x","ply":0}`, `{"action":"select","snapshot":{"games":[{"uri":"x","result":{"ok":false}}]},"uri":"x","ply":0}`} {
		var r Request
		if e := json.Unmarshal([]byte(wire), &r); e != nil {
			t.Fatal(e)
		}
		out := dispatch(r).(c.Result[c.Frame])
		if out.OK || out.Error == nil || out.Error.Code != "snapshot/invalid-shape" {
			t.Fatal(out)
		}
	}
}

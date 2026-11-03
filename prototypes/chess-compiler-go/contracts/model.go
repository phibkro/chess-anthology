package contracts

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
)

// ZeroVersion accepts JSON numeric zero, including alternate spellings of that value.
type ZeroVersion int

func (v *ZeroVersion) UnmarshalJSON(raw []byte) error {
	n, e := strconv.ParseFloat(string(raw), 64)
	if e != nil || n != 0 {
		return fmt.Errorf("expected version zero")
	}
	*v = 0
	return nil
}

// Integer is a nonnegative JavaScript safe integer, excluding negative zero.
type Integer int64

func (i *Integer) UnmarshalJSON(b []byte) error {
	f, e := strconv.ParseFloat(string(b), 64)
	if e != nil || math.IsNaN(f) || math.IsInf(f, 0) || f < 0 || f > 9007199254740991 || math.Trunc(f) != f || f == 0 && math.Signbit(f) {
		return fmt.Errorf("expected safe nonnegative integer")
	}
	*i = Integer(f)
	return nil
}

// Failure is an expected boundary error or a caught backend failure, with stable kind and code.
type Failure struct {
	Kind    string `json:"kind"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (f *Failure) Error() string { return f.Message }

// Fail constructs a stable expected-failure value without panicking.
func Fail(kind, code, message string) *Failure { return &Failure{kind, code, message} }

// Result is the discriminated JSON boundary representation; native functions return a Failure separately.
type Result[T any] struct {
	OK    bool     `json:"ok"`
	Value *T       `json:"value,omitempty"`
	Error *Failure `json:"error,omitempty"`
}

// Success wraps a completed boundary value.
func Success[T any](v T) Result[T] { return Result[T]{OK: true, Value: &v} }

// Failed wraps a failure in the JSON Result representation.
func Failed[T any](e *Failure) Result[T] { return Result[T]{Error: e} }

// Document is the version-zero authored IR, independent of parsing and linking.
type Document struct {
	FormatVersion ZeroVersion `json:"formatVersion"`
	Name          string      `json:"name"`
	Imports       []Text      `json:"imports"`
	Games         []Game      `json:"games"`
	Stories       []Story     `json:"stories"`
}

// Game names a PGN artifact and controls whether importing modules can see it.
type Game struct {
	Exported bool   `json:"exported"`
	Name     string `json:"name"`
	Source   Text   `json:"source"`
}

// Story orders board occurrences across one or more games.
type Story struct {
	Name   string  `json:"name"`
	Scenes []Scene `json:"scenes"`
}

// Scene anchors ordered annotations to a recorded mainline half-move.
type Scene struct {
	Game  string  `json:"game"`
	Name  string  `json:"name"`
	Notes []Note  `json:"notes"`
	Ply   Integer `json:"ply"`
}

// Note separates prose, supplementary arrows and move prompts; its JSON union is strict.
type Note struct {
	Type      string
	Text      Text
	From      Text
	To        Text
	Color     string
	Answer    Text
	AnswerUCI string
}

func (n Note) MarshalJSON() ([]byte, error) {
	switch n.Type {
	case "text":
		return json.Marshal(struct {
			Type string `json:"type"`
			Text Text   `json:"text"`
		}{n.Type, n.Text})
	case "arrow":
		return json.Marshal(struct {
			Type  string `json:"type"`
			From  Text   `json:"from"`
			To    Text   `json:"to"`
			Color string `json:"color"`
		}{n.Type, n.From, n.To, n.Color})
	case "prompt":
		return json.Marshal(struct {
			Type      string `json:"type"`
			Text      Text   `json:"text"`
			Answer    Text   `json:"answer"`
			AnswerUCI string `json:"answerUci,omitempty"`
		}{n.Type, n.Text, n.Answer, n.AnswerUCI})
	}
	return nil, fmt.Errorf("invalid note type")
}
func (n *Note) UnmarshalJSON(b []byte) error {
	var m map[string]json.RawMessage
	if e := json.Unmarshal(b, &m); e != nil {
		return e
	}
	if e := json.Unmarshal(m["type"], &n.Type); e != nil {
		return e
	}
	fields := map[string]any{"type": &n.Type}
	switch n.Type {
	case "text":
		fields["text"] = &n.Text
	case "arrow":
		fields["from"] = &n.From
		fields["to"] = &n.To
		fields["color"] = &n.Color
	case "prompt":
		fields["text"] = &n.Text
		fields["answer"] = &n.Answer
		if _, ok := m["answerUci"]; ok {
			fields["answerUci"] = &n.AnswerUCI
		}
	default:
		return fmt.Errorf("invalid note type")
	}
	if len(fields) != len(m) {
		return fmt.Errorf("unknown or missing note fields")
	}
	for k, p := range fields {
		raw, ok := m[k]
		if !ok || string(raw) == "null" {
			return fmt.Errorf("missing field %s", k)
		}
		if e := json.Unmarshal(raw, p); e != nil {
			return e
		}
	}
	return nil
}

// Position uses zero-based UTF-16 code units, as required by the editor contract.
type Position struct {
	Character int `json:"character"`
	Line      int `json:"line"`
}

// Range identifies source text with an exclusive end position.
type Range struct {
	End   Position `json:"end"`
	Start Position `json:"start"`
}

// Diagnostic carries compiler-owned phase, stage, code and editor location.
type Diagnostic struct {
	Code     string `json:"code"`
	Message  string `json:"message"`
	Phase    string `json:"phase"`
	Range    Range  `json:"range"`
	Severity int    `json:"severity"`
	Stage    string `json:"stage"`
}

// Move pairs canonical SAN with normalized coordinate notation.
type Move struct {
	SAN string `json:"san"`
	UCI string `json:"uci"`
}

// Frame is a recorded position; only the initial frame has null SAN and UCI.
type Frame struct {
	FEN string  `json:"fen"`
	SAN *string `json:"san"`
	UCI *string `json:"uci"`
}

// History retains the initial frame at index zero and the source text digest.
type History struct {
	Frames       []Frame `json:"frames"`
	SourceDigest string  `json:"sourceDigest"`
}

// Occurrence resolves an authored board reference to a game and its legal moves.
type Occurrence struct {
	FEN          string  `json:"fen"`
	Game         string  `json:"game"`
	ID           string  `json:"id"`
	LegalMoves   []Move  `json:"legalMoves"`
	Ply          Integer `json:"ply"`
	SourceDigest string  `json:"sourceDigest"`
	SourceURI    string  `json:"sourceUri"`
}

// Emitted is the parser-independent document output, including errors for invalid content.
type Emitted struct {
	Data        *Document    `json:"data,omitempty"`
	Diagnostics []Diagnostic `json:"diagnostics"`
	Occurrences []Occurrence `json:"occurrences"`
	SourceText  Text         `json:"sourceText"`
	URI         string       `json:"uri"`
}

// GameResult keeps invalid game content as a failure value within a completed build.
type GameResult struct {
	Result Result[History] `json:"result"`
	URI    string          `json:"uri"`
}

// Snapshot is a caller-owned revision; compiler APIs return independent nested values.
type Snapshot struct {
	Games          []GameResult `json:"games"`
	Output         []Emitted    `json:"output"`
	ParentRevision *int         `json:"parentRevision"`
	Revision       int          `json:"revision"`
}

// Work counts parsed documents, emitted documents and uncached game replays.
type Work struct {
	Emitted  int `json:"emitted"`
	Parsed   int `json:"parsed"`
	Replayed int `json:"replayed"`
}

// Update contains a published revision and deterministic work counters.
type Update struct {
	Snapshot Snapshot `json:"snapshot"`
	Work     Work     `json:"work"`
}

// PlaybackScene combines a history, starting anchor and resolved interaction notes.
type PlaybackScene struct {
	After        Integer `json:"after"`
	Frames       []Frame `json:"frames"`
	Game         string  `json:"game"`
	ID           string  `json:"id"`
	Notes        []Note  `json:"notes"`
	SourceDigest string  `json:"sourceDigest"`
}

// Plan is version-one portable playback output for browser consumers.
type Plan struct {
	Format  string          `json:"format"`
	ID      string          `json:"id"`
	Scenes  []PlaybackScene `json:"scenes"`
	Version int             `json:"version"`
}

// Envelope pairs the model with unchanged source for verified restoration.
type Envelope struct {
	Data       Document    `json:"data"`
	Digest     string      `json:"digest"`
	Format     string      `json:"format"`
	SourceText Text        `json:"sourceText"`
	Version    ZeroVersion `json:"version"`
}

// Source preserves configured source ordering across the JSON boundary.
type Source struct {
	URI  Text `json:"uri"`
	Text Text `json:"text"`
}

// SourceInfo is an owned authored model and source spans for editor queries.
type SourceInfo struct {
	Data  *Document        `json:"data"`
	Spans map[string]Range `json:"spans"`
}

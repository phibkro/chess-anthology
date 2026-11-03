// Package chess owns PGN branch traversal and isolates the replaceable rules backend.
package chess

import (
	"fmt"
	"regexp"
	"sort"
	"strings"

	rules "github.com/chesshere-com/chess-on-go"
	c "github.com/phibkro/chess-anthology/compiler/contracts"
)

type Replay struct {
	History   c.History
	positions []*rules.Game
}

func (r *Replay) Position(ply c.Integer) (string, []c.Move, bool) {
	if ply < 0 || int64(ply) >= int64(len(r.positions)) {
		return "", nil, false
	}
	p := r.positions[ply]
	moves := []c.Move{}
	for _, m := range p.LegalMovesList() {
		moves = append(moves, c.Move{SAN: p.GetMoveSan(m), UCI: uci(p, m)})
	}
	sort.Slice(moves, func(i, j int) bool { return moves[i].UCI < moves[j].UCI })
	return fen(p), moves, true
}
func uci(p *rules.Game, m rules.Move) string {
	if !m.IsCastlingMove() {
		return m.UCI()
	}
	parts := strings.Fields(p.FEN())
	from := m.UCI()[:2]
	kingFile := int(from[0] - 'a')
	kingSide := m.To().File() == 6
	for _, right := range parts[2] {
		white := right >= 'A' && right <= 'Z'
		if white != (from[1] == '1') {
			continue
		}
		letter := byte(right)
		if letter >= 'a' {
			letter -= 32
		}
		file := int(letter - 'A')
		if letter == 'K' {
			file = 7
		}
		if letter == 'Q' {
			file = 0
		}
		if (file > kingFile) == kingSide {
			return from + string(byte('a'+file)) + from[1:]
		}
	}
	return m.UCI()
}
func fen(g *rules.Game) string {
	parts := strings.Fields(g.FEN())
	if len(parts) != 6 {
		return g.FEN()
	}
	// chessops omits an en-passant square unless a legal capture exists.
	if parts[3] != "-" {
		legal := false
		for _, m := range g.LegalMovesList() {
			if m.IsEnPassant() {
				legal = true
				break
			}
		}
		if !legal {
			parts[3] = "-"
		}
	}
	// Normalize explicit outer-rook letters to chessops' X-FEN spelling.
	rows := strings.Split(parts[0], "/")
	for color := 0; color < 2; color++ {
		rank := rows[7]
		rook := 'R'
		king := 'K'
		if color == 1 {
			rank = rows[0]
			rook = 'r'
			king = 'k'
		}
		files := []int{}
		file := 0
		kingFile := -1
		for _, piece := range rank {
			if piece >= '1' && piece <= '8' {
				file += int(piece - '0')
				continue
			}
			if piece == rook {
				files = append(files, file)
			}
			if piece == king {
				kingFile = file
			}
			file++
		}
		if len(files) == 0 {
			continue
		}
		for _, f := range files {
			letter := byte('A' + f)
			name := letter
			if f > kingFile && f == files[len(files)-1] {
				name = 'K'
			} else if f < kingFile && f == files[0] {
				name = 'Q'
			}
			if color == 1 {
				letter += 32
				name += 32
			}
			parts[2] = strings.ReplaceAll(parts[2], string(letter), string(name))
		}
	}

	return strings.Join(parts, " ")
}

var tag = regexp.MustCompile(`^\[([A-Za-z0-9_]+)\s+"((?:[^"\\]|\\.)*)"\s*\]`)
var number = regexp.MustCompile(`^[0-9]+\.(?:\.\.)?`)
var sanTokens = regexp.MustCompile(`(?:[NBKRQ]?[a-h]?[1-8]?[-x]?[a-h][1-8](?:=?[nbrqkNBRQK])?|[pnbrqkPNBRQK]?@[a-h][1-8]|[O0o][-–—][O0o](?:[-–—][O0o])?)[+#]?|--|Z0|0000|@@@@|1[-–—]0|0[-–—]1|1/2[-–—]1/2|\*`)

func pgnTokens(source string) (map[string]string, []string, *c.Failure) {
	source = strings.TrimPrefix(source, "\ufeff")
	headers := map[string]string{}
	tokens := []string{}
	started := false
	for i := 0; i < len(source); {
		if strings.ContainsRune(" \t\r\n\ufeff", rune(source[i])) {
			i++
			continue
		}
		if source[i] == '[' {
			if started {
				return nil, nil, c.Fail("chess", "chess/game-count", "Select exactly one PGN game.")
			}
			m := tag.FindStringSubmatch(source[i:])
			if m == nil {
				return nil, nil, c.Fail("chess", "chess/invalid-position", "Invalid PGN tag.")
			}
			headers[m[1]] = strings.NewReplacer(`\"`, `"`, `\\`, `\`).Replace(m[2])
			i += len(m[0])
			continue
		}
		started = true
		if source[i] == '{' {
			j := strings.IndexByte(source[i+1:], '}')
			if j < 0 {
				return nil, nil, c.Fail("chess", "chess/illegal-move", "Unterminated PGN comment.")
			}
			i += j + 2
			continue
		}
		if source[i] == ';' || source[i] == '%' {
			for i < len(source) && source[i] != '\n' {
				i++
			}
			continue
		}
		if source[i] == '(' || source[i] == ')' {
			tokens = append(tokens, string(source[i]))
			i++
			continue
		}
		start := i
		for i < len(source) && !strings.ContainsRune(" \t\r\n{}();[", rune(source[i])) {
			i++
		}
		if i == start {
			return nil, nil, c.Fail("chess", "chess/illegal-move", "Invalid PGN token.")
		}
		t := source[start:i]
		for number.MatchString(t) {
			t = number.ReplaceAllString(t, "")
		}
		if t == "" || t == "..." || strings.HasPrefix(t, "$") {
			continue
		}
		for _, recognized := range sanTokens.FindAllString(t, -1) {
			recognized = strings.NewReplacer("–", "-", "—", "-").Replace(recognized)
			if strings.ContainsAny(recognized, "Oo") || strings.HasPrefix(recognized, "0-0") {
				recognized = strings.ReplaceAll(strings.ReplaceAll(recognized, "0", "O"), "o", "O")
			}
			tokens = append(tokens, recognized)
		}
	}
	if !started && len(headers) == 0 {
		return nil, nil, c.Fail("chess", "chess/game-count", "Select exactly one PGN game.")
	}
	return headers, tokens, nil
}
func ReplayPGN(source c.Text) (out *Replay, failure *c.Failure) {
	defer func() {
		if value := recover(); value != nil {
			out = nil
			failure = c.Fail("infrastructure", "chess/failure", fmt.Sprint(value))
		}
	}()
	headers, tokens, f := pgnTokens(source.UTF8())
	if f != nil {
		return nil, f
	}
	variant := strings.ToLower(headers["Variant"])
	is960 := false
	switch variant {
	case "chess960", "chess 960", "fischerandom", "fischerrandom", "fischer random":
		is960 = true
	case "", "standard", "chess", "from position", "classical", "normal":
	default:
		return nil, c.Fail("chess", "chess/unsupported-rules", "This prototype supports standard chess and Chess960 only.")
	}
	if (is960 || headers["SetUp"] == "1") && headers["FEN"] == "" {
		return nil, c.Fail("chess", "chess/missing-setup", "Provide a FEN header for Chess960 or a game marked SetUp 1.")
	}
	initial := headers["FEN"]
	if initial == "" {
		initial = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
	}
	v := rules.VariantStandard
	// Non-orthodox rook-file setup also needs the library's geometry-aware constructor.
	fields := strings.Fields(initial)
	if len(fields) != 6 {
		return nil, c.Fail("chess", "chess/invalid-position", "Invalid initial position.")
	}
	if is960 || strings.ContainsAny(fields[2], "ABCDEFGHabcdefgh") {
		v = rules.VariantChess960
	}
	pos, e := rules.NewGameFromFENWithVariant(initial, v)
	if e != nil {
		return nil, c.Fail("chess", "chess/invalid-position", "Invalid initial position.")
	}
	out = &Replay{History: c.History{SourceDigest: c.Digest(source), Frames: []c.Frame{{FEN: fen(pos)}}}, positions: []*rules.Game{pos.Clone()}}
	index := 0
	var branch func(*rules.Game, bool, int) *c.Failure
	branch = func(p *rules.Game, main bool, depth int) *c.Failure {
		if depth > 256 {
			return c.Fail("chess", "chess/illegal-move", "PGN variation nesting exceeds 256.")
		}
		var previous *rules.Game
		ended := false
		for index < len(tokens) {
			t := tokens[index]
			index++
			if t == ")" {
				if depth == 0 {
					return c.Fail("chess", "chess/illegal-move", "Unmatched variation.")
				}
				return nil
			}
			if t == "(" {
				if previous == nil {
					return c.Fail("chess", "chess/illegal-move", "Variation has no parent move.")
				}
				if e := branch(previous.Clone(), false, depth+1); e != nil {
					return e
				}
				continue
			}
			if t == "*" || t == "1-0" || t == "0-1" || t == "1/2-1/2" {
				ended = true
				continue
			}
			if ended {
				return c.Fail("chess", "chess/game-count", "Select exactly one PGN game.")
			}
			m, e := p.ParseMoveSAN(t)
			if e != nil {
				return c.Fail("chess", "chess/illegal-move", "Illegal recorded move: "+t)
			}
			san := p.GetMoveSan(m)
			coord := uci(p, m)
			previous = p.Clone()
			p.MakeMove(m)
			if main {
				out.History.Frames = append(out.History.Frames, c.Frame{FEN: fen(p), SAN: &san, UCI: &coord})
				out.positions = append(out.positions, p.Clone())
			}
		}
		if depth > 0 {
			return c.Fail("chess", "chess/illegal-move", "Unterminated variation.")
		}
		return nil
	}
	if f := branch(pos, true, 0); f != nil {
		return nil, f
	}
	return out, nil
}

// LegalAnswer checks move legality without imposing the playback target's canonical-SAN restriction.
func (r *Replay) LegalAnswer(ply c.Integer, san string) bool {
	if ply < 0 || int64(ply) >= int64(len(r.positions)) {
		return false
	}
	_, e := r.positions[ply].ParseMoveSAN(san)
	return e == nil
}

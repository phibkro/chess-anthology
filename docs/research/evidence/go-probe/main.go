package main
import (
 "encoding/json"
 "fmt"
 "os"
 "strings"
 here "github.com/chesshere-com/chess-on-go"
 lavren "github.com/lavren1974/chess960"
)
type Result struct { Candidate string `json:"candidate"`; Case string `json:"case"`; Passed bool `json:"passed"`; Observed string `json:"observed"` }
func main() {
 results:=[]Result{}
 add:=func(c,id string,ok bool,obs string){results=append(results,Result{c,id,ok,obs})}
 for _,tc:=range []struct{id,fen,move,want string}{
  {"double-move-castling","k7/8/8/8/8/8/8/4K2R w H - 0 1","O-O","5RK1"},
  {"stationary-king","6k1/8/8/8/8/8/8/6KR w H - 0 1","O-O","5RK1"},
  {"stationary-rook","k7/8/8/8/8/8/8/4KR2 w F - 0 1","O-O","5RK1"},
  {"king-rook-swap","4k3/8/8/8/8/8/8/2RK4 w C - 0 1","O-O-O","2KR4"},
 } {
  g,e:=here.NewGameFromFENWithVariant(tc.fen,here.VariantChess960)
  if e==nil { e=g.TryMoveSAN(tc.move) }
  if e!=nil {add("chess-on-go",tc.id,false,e.Error());continue}
  out:=g.FEN();rank:=strings.Split(strings.Split(out," ")[0],"/")[7];add("chess-on-go",tc.id,rank==tc.want,out)
 }
 gBlack,eBlack:=here.NewGameFromFENWithVariant("6kr/8/8/8/8/8/8/6K1 b h - 0 1",here.VariantChess960)
 if eBlack==nil {eBlack=gBlack.TryMoveSAN("O-O")}
 outBlack:="";if eBlack==nil {outBlack=gBlack.FEN()}
 add("chess-on-go","black-stationary-king",eBlack==nil&&strings.HasPrefix(outBlack,"5rk1/"),fmt.Sprintf("fen=%s error=%v",outBlack,eBlack))
 for _,tc:=range []struct{id,fen string}{
  {"no-rights-no-castling","4k3/8/8/8/8/8/8/4K2R w - - 0 1"},
  {"attacked-transit-forbids-castling","k4r2/8/8/8/8/8/8/4K2R w H - 0 1"},
 } {
  g,e:=here.NewGameFromFENWithVariant(tc.fen,here.VariantChess960);n:=0
  if e==nil {for _,m:=range g.LegalMovesList(){if m.IsCastlingMove(){n++}}}
  add("chess-on-go",tc.id,e==nil&&n==0,fmt.Sprintf("castles=%d error=%v",n,e))
 }
 seen:=map[string]bool{};good:=true
 for i:=0;i<960;i++ {
  fen,e:=here.Chess960StartingFEN(i)
  if e!=nil {good=false;break};parts:=strings.Split(fen," ");ranks:=strings.Split(parts[0],"/")
  rank:=ranks[7];bishop:=[]int{};rook:=[]int{};king:=-1
  for j,c:=range rank {switch c {case 'B':bishop=append(bishop,j);case 'R':rook=append(rook,j);case 'K':king=j}}
  if seen[rank] ||len(bishop)!=2||len(rook)!=2||bishop[0]%2==bishop[1]%2||!(rook[0]<king&&king<rook[1])||strings.ToLower(rank)!=ranks[0]||ranks[1]!="pppppppp"||ranks[6]!="PPPPPPPP" {good=false;break}
  seen[rank]=true
  g,e:=here.NewGameFromFENWithVariant(fen,here.VariantChess960);if e!=nil||g.FEN()!=fen {good=false;break}
 }
 add("chess-on-go","960-unique-valid-starts-roundtrip",good&&len(seen)==960,fmt.Sprintf("uniqueStarts=%d",len(seen)))
 g,e:=here.NewGameFromFENWithVariant("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",here.VariantChess960)
 add("chess-on-go","explicit-variant-orthodox-array",e==nil&&g.Variant()==here.VariantChess960,fmt.Sprintf("error=%v",e))
 pgn:="[Event \"Probe\"]\n[Result \"*\"]\n\n1. e4 $1 $3 {[%cal Ge2e4] note} e5 (1... e6 2. Qh9) 2. Nf3 *"
 g=&here.Game{};e=g.LoadPGN(pgn);out:="";if e==nil {out=g.PGN()}
 add("chess-on-go","invalid-side-variation-rejected",e!=nil,fmt.Sprintf("error=%v",e))
 add("chess-on-go","pgn-annotations-variation-preserved",e==nil&&strings.Contains(out,"$1")&&strings.Contains(out,"$3")&&strings.Contains(out,"[%cal")&&strings.Contains(out,"("),out)
 record,e:=here.ParseEPD("4k3/8/8/8/8/8/8/4K3 w - - custom \"first\"; custom \"second\"; id \"probe\";")
 add("chess-on-go","duplicate-epd-operation-retained",e==nil&&len(record.Operation("custom"))==2,fmt.Sprintf("custom=%v error=%v",record.Operation("custom"),e))
 opt,e:=lavren.FEN("4k3/8/8/8/8/8/8/4K2R w - - 0 1");n:=0
 if e==nil {l:=lavren.NewGame(opt);for _,m:=range l.ValidMoves(){if m.HasTag(lavren.KingSideCastle)||m.HasTag(lavren.QueenSideCastle){n++}}}
 add("lavren1974/chess960","no-rights-no-castling",e==nil&&n==0,fmt.Sprintf("castles=%d error=%v",n,e))
 _,e=lavren.FEN("6k1/8/8/8/8/8/8/6KR w H - 0 1")
 add("lavren1974/chess960","shredder-fen-accepted",e==nil,fmt.Sprintf("error=%v",e))
 enc:=json.NewEncoder(os.Stdout);enc.SetIndent("","  ");if e:=enc.Encode(results);e!=nil {panic(e)}
}

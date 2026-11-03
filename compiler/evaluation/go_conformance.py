"""Differential public-API checks; shared fixtures, generated documents and edited workspaces."""
import json
import os
from pathlib import Path
import random
import subprocess
import sys


def normalize(value):
    if isinstance(value, list):
        return [normalize(item) for item in value]
    if isinstance(value, dict):
        result = {key: normalize(item) for key, item in value.items()}
        # Diagnostic prose is implementation-specific; codes, phase, severity and UTF-16 ranges are contractual.
        if all(key in result for key in ["code", "message", "phase", "range"]):
            assert result["message"]
            result.pop("message")
        if "ok" in result and result["ok"] is False and "error" in result:
            assert result["error"].get("message")
            result["error"].pop("message", None)
            result["error"].pop("paths", None)
        if "legalMoves" in result:
            result["legalMoves"].sort(key=lambda move: (move["uci"], move["san"]))
        return result
    return value


def main():
    current, binary, destination = [Path(arg).resolve() for arg in sys.argv[1:4]]
    destination.mkdir(parents=True, exist_ok=True)
    bun = os.environ.get("CHESS_BUN", "bun")
    oracle = destination / "oracle.mts"
    oracle.write_text('import * as compiler from '+json.dumps(str(current / 'src/compiler/index.ts'))+';\n'
      'import {parseStructured} from '+json.dumps(str(current / 'src/contracts/index.ts'))+';\n'
      'const map=items=>new Map(items.map(({uri,text})=>[uri,text]));\n'
      'for(const line of (await Bun.stdin.text()).trim().split("\\n")){const r=JSON.parse(line);let result;'
      'switch(r.action){case "compile":result=await compiler.compile(map(r.sources));break;'
      'case "session":{const c=compiler.createCompiler();for(const sources of r.updates)result=await c.update(map(sources));break;}'
      'case "decode":result=compiler.decode(r.source);break;case "print":result=compiler.printStructured(r.data);break;'
      'case "structured":result=parseStructured(r.data);break;'
      'default:throw Error("unsupported oracle request");}'
      'console.log(JSON.stringify(result));}\n')
    requests = []
    rng = random.Random(20261103)
    texts = ['', '\ud800', '\udfff', '\ud800\udfff', '😀 ♞ é', '\r\n\u0000', '"\\</script>']
    for i in range(250):
        text = rng.choice(texts) + ''.join(rng.choice('ab é😀') for _ in range(rng.randrange(12)))
        note = rng.choice([{"type":"text","text":text}, {"type":"arrow","from":"e2","to":"e4","color":"green"}, {"type":"prompt","text":text,"answer":"e4"}])
        data = {"formatVersion":0,"name":f"module{i}","imports":[text],"games":[{"name":"g","source":text,"exported":bool(i%2)}],
                "stories":[{"name":"s","scenes":[{"name":"b","game":"g","ply":rng.choice([0,1,9007199254740991]),"notes":[note]}]}]}
        requests.append({"action":"print","data":data})
        flat = 'module demo; game g from '+json.dumps(text)+'; story s {board b game g after 0 {text '+json.dumps(text)+';}}'
        requests.append({"action":"decode","source":'// retained\r\n'+flat})
    corpus=current/'evaluation/corpus'
    sources=[{"uri":'file:///corpus/'+name,"text":(corpus/name).read_text()} for name in ['story.chess-story','opening.pgn','composition.pgn','reti.pgn']]
    requests.append({"action":"compile","sources":sources})
    library={"uri":"file:///edit/library.chess-story","text":'module library; export game opening from "./game.pgn";'}
    story={"uri":"file:///edit/story.chess-story","text":'module storyModule; import "./library.chess-story"; story s {board b game opening after 1 {text "original";}}'}
    game={"uri":"file:///edit/game.pgn","text":"1. e4 e5 2. Nf3 Nc6 *"}
    state=[library,story,game];updates=[state]
    for i in range(35):
        state=json.loads(json.dumps(state))
        if i%5==0:
            state[2]['text']=rng.choice(['1. d4 d5 *','1. e4 e5 *','1. e5 *'])
        else:
            state[1]['text']=story['text'].replace('original',f'prose {i}')
        updates.append(state)
        requests.append({"action":"session","updates":updates[:]})
        requests.append({"action":"compile","sources":state})
    requests.append({'action':'decode','source':'module raw; story s { board b game g after 0 { text "raw'+chr(0xd800)+'"; } }'})
    invalid=['module x; @','module x; story s {','module x; game g from "\\q";','module module;','module x; story s {board b game g after 9007199254740992 {}}']
    requests.extend({"action":"decode","source":text} for text in invalid)
    pgns=['1. e4 e5 (1... e6 2. Qh4) *','1. e4 e5 (1... e6 2. Qh9) *','1. e4 (1. d4 d5 (1... Nf6)) e5 *','[Variant "Chess960"]\n*']
    requests.extend({"action":"compile","sources":[{"uri":"file:///pgn.pgn","text":text}]} for text in pgns)
    requests.extend({"action":"decode","source":source} for source in ['module\vvertical;', 'module\rbareCR;', '\ufeffmodule bom;', 'module\u00a0nbsp;'])
    for source in ['module identities; story repeated {} story repeated {}', 'module identities; game g from "./g.pgn"; story lesson {board same game g after 0 {} board same game g after 0 {}}']:
        requests.append({"action":"compile","sources":[{"uri":"file:///dupes/s.chess-story","text":source},{"uri":"file:///dupes/g.pgn","text":"*"}]})
    for path in ['./%2e%2e/lib.chess-story', './.%2e/lib.chess-story', './%2E./lib.chess-story', '../lib.chess-story']:
        requests.append({"action":"compile","sources":[
            {"uri":"file:///root/sub/story.chess-story","text":'module linked; import '+json.dumps(path)+'; story s {board b game g after 0 {}}'},
            {"uri":"file:///root/lib.chess-story","text":'module library; export game g from "./g.pgn";'},
            {"uri":"file:///root/g.pgn","text":"*"}]})
    for data in [
        {"formatVersion":0,"name":"valid","imports":None,"games":[],"stories":[]},
        {"formatVersion":0,"name":"valid","imports":[],"games":[],"stories":[],"unknown":True},
        {"formatVersion":-0.0,"name":"valid","imports":[],"games":[],"stories":[]},
    ]: requests.append({"action":"structured","data":data})
    wire=''.join(json.dumps(request,ensure_ascii=True)+'\n' for request in requests)
    outputs=[]
    for command in [[bun,str(oracle)],[str(binary)]]:
        p=subprocess.run(command,input=wire,text=True,capture_output=True,check=True,timeout=180)
        lines=p.stdout.splitlines()
        if len(lines)!=len(requests):raise ValueError('Missing responses')
        outputs.append([json.loads(line) for line in lines])
    mismatches=[]
    for i,(left,right) in enumerate(zip(*outputs)):
        if normalize(left)!=normalize(right):
            mismatches.append({"index":i,"request":requests[i],"bun":left,"go":right})
    report={"format":"go-compiler-conformance","version":1,"cases":len(requests),"mismatches":mismatches,"passed":not mismatches,
            "normalization":"Diagnostic/failure prose and optional schema-error paths excluded; legal move sets sorted. All remaining public snapshot/model/frame fields compared."}
    (destination/'go-conformance.json').write_text(json.dumps(report,indent=2,ensure_ascii=True)+'\n')
    print(json.dumps({"cases":len(requests),"mismatches":len(mismatches),"passed":not mismatches}))
    if mismatches:
        print('First differing request indices:', [row['index'] for row in mismatches[:10]])
        raise SystemExit(1)


if __name__=='__main__':main()

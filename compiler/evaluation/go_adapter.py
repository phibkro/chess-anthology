"""Stage a process-boundary adapter for shared acceptance tests; never time this bridge."""
import json
from pathlib import Path


def adapter(binary, destination):
    code = '''import {spawnSync} from "bun";
const binary = BINARY;
const sources = map => [...map].map(([uri,text])=>({uri,text}));
const rpc = request => {
 const p = spawnSync([binary],{stdin:new TextEncoder().encode(JSON.stringify(request)+"\\n"),stdout:"pipe",stderr:"pipe"});
 if(p.exitCode!==0)throw Error(new TextDecoder().decode(p.stderr));
 return JSON.parse(new TextDecoder().decode(p.stdout));
};
export const compile = async map => rpc({action:"compile",sources:sources(map)});
export const createCompiler = () => {
 const updates=[];
 return {update:async map=>{updates.push(sources(map));return rpc({action:"session",updates});}};
};
export const decode = source => rpc({action:"decode",source});
export const printStructured = data => rpc({action:"print",data});
export const envelope = (data,source) => {
 const result=rpc({action:"envelope",data,source});if(!result.ok)throw Error(result.error.message);return result.value;
};
export const restore = input => rpc({action:"restore",input});
export const selectPosition = (snapshot,uri,ply) => rpc({action:"select",snapshot,uri,ply});
export const createPlaybackPlan = (snapshot,uri,story) => rpc({action:"plan",snapshot,uri,story});
'''.replace("BINARY", json.dumps(str(binary)))
    path = destination / "go-adapter.mjs"
    path.write_text(code)
    return path


def stage_go(current, destination, binary, bun, stage, run):
    destination.mkdir(parents=True, exist_ok=True)
    entry, provenance = stage(current, destination)
    bridge = adapter(binary, destination)
    evaluation = destination / "evaluate.mts"
    evaluation.write_text(evaluation.read_text().replace(str(current / "src/compiler/index.js"), str(bridge)))
    # Native worker gets the exact workload maps produced by the maintained TS fixture factory.
    payload = destination / "workloads.json"
    generator = destination / "workloads.mts"
    generator.write_text('import {createWorkload,editWorkload,expectedWork} from ' + json.dumps(str(current / "evaluation/workload.mts")) + ';\n'
                         'const rows=[];for(const stories of [1,10,100]){const initial=createWorkload(stories);'
                         'for(const scenario of ["initial","unchanged","prose","shared-game"]){'
                         'const next=scenario==="initial"?initial:editWorkload(initial,scenario,1);'
                         'const encode=map=>[...map].map(([uri,text])=>({uri,text}));'
                         'const samples=Array.from({length:7},(_,revision)=>encode(scenario==="initial"?initial:editWorkload(initial,scenario,revision)));'
                         'rows.push({stories,scenario,initial:encode(initial),sources:encode(next),samples,expected:expectedWork(stories,scenario)});}}'
                         'console.log(JSON.stringify(rows));')
    payload.write_text(run([bun,generator],current).stdout)
    return entry, payload, provenance

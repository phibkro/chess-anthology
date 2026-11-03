"""Compare delivery modes within each compiler revision; never label packaging as native AOT."""
import hashlib
import json
import os
import platform
from pathlib import Path
import random
import shutil
import statistics
import subprocess
import sys
import time

sys.dont_write_bytecode = True

from runtime_compare import holm, inference
from go_adapter import stage_go


def run(command, cwd, env=None, timeout=180):
    return subprocess.run([str(item) for item in command], cwd=cwd, env=env,
                          capture_output=True, text=True, timeout=timeout, check=True)


def failure_output(error):
    def text(value):
        return value.decode("utf-8", errors="replace") if isinstance(value, bytes) else value
    return {"reason": str(error), "stdout": text(getattr(error, "stdout", None)),
            "stderr": text(getattr(error, "stderr", None))}


def controlled_environment(parent):
    env = dict(parent, CHESS_BENCH_ITERATIONS="5", CHESS_BENCH_WARMUPS="2", CHESS_BENCH_SIZES="1,10,100")
    for key in ["NODE_COMPILE_CACHE", "NODE_DISABLE_COMPILE_CACHE", "NODE_OPTIONS", "BUN_OPTIONS", "GOGC", "GOMEMLIMIT", "GOMAXPROCS"]:
        env.pop(key, None)
    return env


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def stage(directory, destination):
    """Keep evaluation assertions/timing loops; relocate imports and untimed provenance only."""
    identity = destination / "identity.mjs"
    provenance = {
        "compilerCommit": run(["git", "rev-parse", "HEAD"], directory).stdout.strip(),
        "compilerDirty": bool(run(["git", "status", "--porcelain", "--", "src", "package.json"], directory).stdout),
        "lockDigest": sha(directory / "pnpm-lock.yaml"),
        "harnessDigest": hashlib.sha256(b"".join((directory / "evaluation" / name).read_bytes()
                                                 for name in ["evaluate.mts", "benchmark.mts", "workload.mts"])).hexdigest(),
    }
    identity.write_text("export const collectIdentity = async () => ({..." + json.dumps(provenance) +
                        ", environment: {arch: process.arch, platform: process.platform, runtime: "
                        "{name: process.versions.bun ? 'bun' : 'node', version: process.versions.bun ?? process.versions.node}}});\n")
    for kind in ["evaluate", "benchmark"]:
        original = directory / "evaluation" / f"{kind}.mts"
        text = original.read_text()
        header, body = text.split("const value =", 1)
        import re
        def relocate(match):
            name = match.group(1)
            target = identity if name == "./identity.mjs" else (original.parent / name).resolve()
            return 'from ' + json.dumps(str(target))
        header = re.sub(r'from "(\.[^"]+)"', relocate, header)
        body = ("const value =" + body).replace("import.meta.url", json.dumps(original.as_uri()))
        (destination / f"{kind}.mts").write_text(header + "\nexport const execute = async () => {\n" + body + "\n};\n")
    # A single first compile: end-to-end wall time includes runtime/module startup and output flush.
    compiler = json.dumps(str(directory / "src/compiler/index.ts"))
    workload = json.dumps(str(directory / "evaluation/workload.mts"))
    (destination / "once.mts").write_text(
        f'import {{createCompiler}} from {compiler};\nimport {{createWorkload}} from {workload};\n'
        'export const execute = async () => {const r = await createCompiler().update(createWorkload(1));'
        'if (!r.ok || r.value.snapshot.output.length !== 2 || r.value.snapshot.output.some(d => d.diagnostics.length)) '
        'throw Error("First compilation failed"); console.log(JSON.stringify(r.value.work));};\n')
    entry = destination / "entry.mts"
    entry.write_text('import {execute as evaluate} from "./evaluate.mts";\n'
                     'import {execute as benchmark} from "./benchmark.mts";\n'
                     'import {execute as once} from "./once.mts";\n'
                     'const mode = process.env.CHESS_MODE_TASK;\n'
                     'const task = mode === "evaluate" ? evaluate : mode === "benchmark" ? benchmark : mode === "once" ? once : undefined;\n'
                     'if (!task) throw Error("Unknown execution-mode task");\n'
                     'task().catch((error: unknown) => {console.error(error); process.exitCode = 1;});\n')
    return entry, provenance


def aot_probe(bun, destination):
    """Unknown build flags are silently ignored by some releases: test documented behavior."""
    source = destination / "aot-capability.ts"
    source.write_text('const value: number = "invalid"; console.log(value);\n')
    result = subprocess.run([bun, "compile", "--no-script", str(source), "--outfile", str(destination / "invalid-aot")],
                            cwd=destination, capture_output=True, text=True, timeout=120)
    supported = result.returncode != 0 and "TS2322" in (result.stdout + result.stderr)
    return {"available": supported, "exitCode": result.returncode,
            "stdout": result.stdout, "stderr": result.stderr,
            "criterion": "Documented bun compile command must reject an invalid number assignment with TS2322; --aot flag acceptance alone is insufficient"}


def make_sea(node, bundle, destination, cache, log):
    config = destination.with_suffix(".json")
    blob = destination.with_suffix(".blob")
    config.write_text(json.dumps({"main": str(bundle), "output": str(blob),
                                  "disableExperimentalSEAWarning": True, "useCodeCache": cache}))
    log.append(run([node, "--experimental-sea-config", config], destination.parent).stderr)
    shutil.copy2(node, destination)
    destination.chmod(0o755)
    log.append(run(["pnpm", "--package=postject@1.0.0-alpha.6", "dlx", "postject", destination,
                    "NODE_SEA_BLOB", blob, "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"],
                   destination.parent).stdout)
    blob.unlink()


def prepare(base, current, destination, bun, node):
    arms, builds, unavailable = {}, {}, {}
    for label, directory in [("legacy", base), ("current", current)]:
        requested = set(os.environ.get("CHESS_MODE_ARMS", "").split(",")) - {""}
        if label == "legacy" and requested and not requested.intersection({"node-tsx","node-bundle","node-cache","node-sea","node-sea-cache","legacy-bun-source"}):
            continue
        folder = destination / label
        folder.mkdir(parents=True, exist_ok=True)
        entry, provenance = stage(directory, folder)
        def add(name, command, artifact=None, extra_env=None):
            arms[name] = {"command": [str(x) for x in command], "cwd": str(directory),
                          "env": extra_env or {}, "revision": label, **provenance}
            if artifact:
                arms[name].update(artifactBytes=artifact.stat().st_size, artifactDigest=sha(artifact))
        if label == "legacy":
            add("node-tsx", [node, "--import", "tsx", entry])
            bundle = folder / "node-bundle.cjs"
            started = time.perf_counter()
            esbuild = directory / "node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/bin/esbuild"
            if not esbuild.is_file():
                raise ValueError("Install the pinned legacy lockfile (esbuild 0.25.12 is required)")
            log = [run([esbuild, entry, "--bundle", "--platform=node", "--format=cjs", f"--outfile={bundle}"], directory).stderr]
            builds["node-bundle"] = {"seconds": time.perf_counter() - started, "log": log}
            add("node-bundle", [node, bundle], bundle)
            add("node-cache", [node, bundle], bundle, {"NODE_COMPILE_CACHE": str(folder / "node-cache")})
            for cache in [False, True]:
                name = "node-sea-cache" if cache else "node-sea"
                started = time.perf_counter()
                log = []
                executable = folder / name
                try:
                    make_sea(node, bundle, executable, cache, log)
                    add(name, [executable], executable)
                    builds[name] = {"seconds": time.perf_counter() - started, "log": log}
                except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
                    unavailable[name] = failure_output(error)
            add("legacy-bun-source", [bun, entry])
        else:
            add("bun-source", [bun, entry])
            for name, flags, filename in [
                ("bun-bundle", [], "bun-bundle.mjs"),
                ("bun-executable", ["--compile"], "bun-executable"),
                ("bun-bytecode", ["--compile", "--bytecode"], "bun-bytecode"),
            ]:
                artifact = folder / filename
                started = time.perf_counter()
                log = run([bun, "build", entry, "--target=bun", "--format=esm", *flags, "--outfile", artifact], directory)
                builds[name] = {"seconds": time.perf_counter() - started, "stdout": log.stdout, "stderr": log.stderr}
                add(name, [bun, artifact] if name == "bun-bundle" else [artifact], artifact)
            capability = aot_probe(bun, folder)
            (folder / "aot-capability.json").write_text(json.dumps(capability, indent=2) + "\n")
            if capability["available"]:
                artifact = folder / "bun-aot"
                started = time.perf_counter()
                try:
                    log = run([bun, "compile", "--no-script", entry, "--outfile", artifact], directory)
                    builds["bun-aot"] = {"seconds": time.perf_counter() - started, "stdout": log.stdout, "stderr": log.stderr}
                    add("bun-aot", [artifact], artifact)
                except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
                    unavailable["bun-aot"] = {**failure_output(error), "reason": "Capability probe passed but compiler build failed"}
            else:
                unavailable["bun-aot"] = capability
    go_module = current.parent / "chess-compiler-go"
    if go_module.is_dir():
        go = shutil.which(os.environ.get("CHESS_GO", "go"))
        if not go:
            unavailable["go-native"] = {"reason": "Go toolchain unavailable; set CHESS_GO"}
        else:
            folder = destination / "go"
            folder.mkdir(parents=True, exist_ok=True)
            binary = folder / "chess-compiler-go"
            started = time.perf_counter()
            command = [go, "build", "-trimpath", "-o", str(binary), "./cmd/chess-compiler"]
            log = run(command, go_module, dict(os.environ, CGO_ENABLED="0"))
            version = run([go, "version"], go_module).stdout.strip()
            builds["go-native"] = {"seconds": time.perf_counter()-started, "command": command, "stdout": log.stdout, "stderr": log.stderr}
            entry, payload, provenance = stage_go(current, folder, binary, bun, stage, run)
            parity = run([sys.executable, current / "evaluation/go_conformance.py", current, binary, folder], current, dict(os.environ, CHESS_BUN=bun))
            (folder / "conformance-output.txt").write_text(parity.stdout)
            provenance["compilerDirty"] = bool(run(["git","status","--porcelain","--","."],go_module).stdout)
            provenance["lockDigest"] = sha(go_module / "go.sum")
            sources = sorted(go_module.rglob("*.go"))
            source_digest = hashlib.sha256(b"".join(str(p.relative_to(go_module)).encode()+b"\0"+p.read_bytes() for p in sources)).hexdigest()
            arms["go-native"] = {"command": [str(binary), "--worker", str(payload)], "evaluationCommand": [bun,str(entry)],
                                 "cwd": str(current), "env": {}, "revision": "current", "crossLanguage": True,
                                 "runtimeVersion": version, "sourceDigest": source_digest, "workloadDigest": sha(payload),
                                 "artifactBytes": binary.stat().st_size, "artifactDigest": sha(binary), **provenance}
    return arms, builds, unavailable


def check_evaluations(arms, evaluations):
    for revision in {arm["revision"] for arm in arms.values()}:
        control = "node-tsx" if revision == "legacy" else "bun-source"
        if control not in evaluations:
            raise ValueError(f"Correctness control unavailable: {control}")
        reference = evaluations[control]
        for name, report in evaluations.items():
            if arms[name]["revision"] != revision:
                continue
            for key in ["corpusDigest", "budgets", "cases"]:
                left, right = report[key], reference[key]
                if key == "cases" and arms[name].get("crossLanguage"):
                    def diagnostics(value):
                        copy = json.loads(json.dumps(value))
                        for case in copy:
                            for diagnostic in case["diagnostics"]:
                                diagnostic.pop("message", None)
                        return copy
                    left, right = diagnostics(left), diagnostics(right)
                if left != right:
                    raise ValueError(f"{name} differs from {control} in {key}")


def self_test():
    arms = {"node-tsx": {"revision": "legacy"}, "node-bundle": {"revision": "legacy"}}
    reference = {"corpusDigest": "same", "budgets": [1], "cases": ["valid", "invalid"]}
    check_evaluations(arms, {name: reference for name in arms})
    for key, bad in [("corpusDigest", "different"), ("budgets", []), ("cases", [])]:
        try:
            check_evaluations(arms, {"node-tsx": reference, "node-bundle": {**reference, key: bad}})
        except ValueError:
            pass
        else:
            raise AssertionError(f"Incomparable {key} accepted")
    try:
        check_evaluations(arms, {"node-bundle": reference})
    except ValueError:
        pass
    else:
        raise AssertionError("Missing correctness control accepted")
    sanitized = controlled_environment({"NODE_DISABLE_COMPILE_CACHE": "1", "NODE_COMPILE_CACHE": "wrong", "NODE_OPTIONS": "--jitless", "BUN_OPTIONS": "--smol", "UNCHANGED": "yes"})
    assert "NODE_DISABLE_COMPILE_CACHE" not in sanitized and "NODE_COMPILE_CACHE" not in sanitized
    assert "NODE_OPTIONS" not in sanitized and "BUN_OPTIONS" not in sanitized and sanitized["UNCHANGED"] == "yes"
    timeout = subprocess.TimeoutExpired(["probe"], 1, output=b"partial\xff", stderr=b"error")
    encoded = json.dumps(failure_output(timeout))
    assert json.loads(encoded)["stdout"] == "partial\ufffd"
    print("Execution-mode comparability, environment and failure-report guards passed")


def invoke(arm, task, env):
    child_env = dict(env, **arm["env"], CHESS_MODE_TASK=task)
    started = time.perf_counter()
    command = arm.get("evaluationCommand", arm["command"]) if task == "evaluate" else arm["command"]
    result = run(command, arm["cwd"], child_env)
    return json.loads(result.stdout), (time.perf_counter() - started) * 1000


def main():
    base, current, destination = [Path(arg).resolve() for arg in sys.argv[1:4]]
    destination.mkdir(parents=True, exist_ok=True)
    bun, node = shutil.which(os.environ.get("CHESS_BUN", "bun")), shutil.which(os.environ.get("CHESS_NODE", "node"))
    if not bun or not node:
        raise ValueError("Bun and Node executables are required; CHESS_BUN/CHESS_NODE may select pinned binaries")
    blocks = int(os.environ.get("CHESS_RUNTIME_BLOCKS", "16"))
    if not 3 <= blocks <= 16:
        raise ValueError("CHESS_RUNTIME_BLOCKS must be 3..16")
    harness_digest = sha(Path(__file__))
    env = controlled_environment(os.environ)
    arms, builds, unavailable = prepare(base, current, destination, bun, node)
    evaluations, failures = {}, {}
    for name, arm in arms.items():
        try:
            report, _ = invoke(arm, "evaluate", env)
            if report.get("passed") is not True:
                raise ValueError("Evaluation did not pass")
            if arm.get("crossLanguage"):
                report["environment"]["runtime"] = {"name":"go", "version":arm["runtimeVersion"], "adapter":"Bun shared acceptance harness"}
            evaluations[name] = report
            (destination / f"{name}-evaluation.json").write_text(json.dumps(report, indent=2) + "\n")
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, ValueError) as error:
            failures[name] = failure_output(error)
    if "node-cache" in evaluations:
        cache_env = dict(env, **arms["node-cache"]["env"])
        cache_probe = run([node, "-e", "console.log(JSON.stringify({directory:require('node:module').getCompileCacheDir()}))"], base, cache_env)
        cache_directory = json.loads(cache_probe.stdout).get("directory")
        if not cache_directory or not any(Path(cache_directory).rglob("*")):
            raise ValueError("Node compile cache is not active/populated")
        arms["node-cache"]["cacheDirectoryVerified"] = cache_directory
    check_evaluations(arms, evaluations)
    active = {name: arm for name, arm in arms.items() if name in evaluations}
    requested = set(os.environ.get("CHESS_MODE_ARMS", "").split(",")) - {""}
    if requested:
        unknown = requested - arms.keys() - unavailable.keys()
        if unknown:
            raise ValueError(f"Unknown modes: {unknown}")
        controls = {"node-tsx" if arm["revision"] == "legacy" else "bun-source" for name,arm in active.items() if name in requested}
        active = {name: arm for name,arm in active.items() if name in requested or name in controls}
    # Evaluation warms Node's explicitly persistent disk cache; all other runtime/JIT state dies per child.
    for name, arm in active.items():
        invoke(arm, "benchmark", env)
        invoke(arm, "once", env)
    reports = {name: [] for name in active}
    rng = random.Random(20261103)
    names = list(active)
    rng.shuffle(names)
    schedule = []
    for block in range(blocks):
        # Rotations and reversal distribute positions without materializing n! permutations.
        order = names[block % len(names):] + names[:block % len(names)]
        if (block // len(names)) % 2:
            order.reverse()
        schedule.append(order)
        for name in order:
            report, wall = invoke(active[name], "benchmark", env)
            first, first_wall = invoke(active[name], "once", env)
            report.update(processWallMs=wall, firstCompileWallMs=first_wall, firstCompileWork=first)
            if active[name].get("crossLanguage"):
                for key in ["compilerCommit", "compilerDirty", "harnessDigest", "lockDigest", "sourceDigest"]:
                    report[key] = active[name][key]
            reports[name].append(report)
            (destination / f"{name}-{block:02}.json").write_text(json.dumps(report, indent=2) + "\n")
    rows = []
    for name, arm in active.items():
        control = "node-tsx" if arm["revision"] == "legacy" else "bun-source"
        if name == control:
            continue
        for metric in ["firstCompileWallMs", *[(size, scenario) for size in [1, 10, 100]
                        for scenario in ["initial", "unchanged", "prose", "shared-game"]]]:
            def measurements(key):
                if isinstance(metric, str):
                    return [report[metric] for report in reports[key]]
                return [next(row["medianMs"] for row in report["results"]
                             if (row["stories"], row["scenario"]) == metric) for report in reports[key]]
            before, after = measurements(control), measurements(name)
            rows.append({"control": control, "arm": name, "metric": metric,
                         "beforeMs": statistics.median(before), "afterMs": statistics.median(after), **inference(before, after)})
    holm(rows)
    summary = {"format": "chess-execution-modes", "version": 1, "blocks": blocks, "schedule": schedule, "harnessDigest": harness_digest, "supportDigests": {name: sha(current / "evaluation" / name) for name in ["go_adapter.py","go_conformance.py"] if (current / "evaluation" / name).is_file()}, "machine": {"platform": platform.platform(), "cpu": next((line.split(":", 1)[1].strip() for line in Path("/proc/cpuinfo").read_text().splitlines() if line.startswith("model name")), "unavailable") if Path("/proc/cpuinfo").exists() else platform.processor()},
               "versions": {"bun": run([bun, "--version"], current).stdout.strip(), "node": run([node, "--version"], current).stdout.strip()},
               "arms": active, "builds": builds, "unavailable": unavailable, "evaluationFailures": failures,
               "method": "Paired fresh process blocks, warm-operation medians and separate end-to-end first compile wall time; nominal paired-bootstrap 95% intervals, exact sign-flip test, Holm correction across all rows; controls within each compiler revision only",
               "scope": "One-story first compile excludes artifact construction. Warm benchmark excludes startup and module loading. Cache arm has prepopulated Node disk cache. Shared corpus/data remain on disk; no standalone-distribution claim. RSS is process-wide, not allocations. Build times are single observations, not inferred effects.",
               "rows": rows}
    (destination / "execution-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    lines = ["### Compiler execution modes", "", summary["method"], "", summary["scope"], "",
             "| Control | Mode | First compile ms | Warm initial, 100 stories ms | Artifact MiB |",
             "| --- | --- | ---: | ---: | ---: |"]
    for name, arm in active.items():
        startup = statistics.median(report["firstCompileWallMs"] for report in reports[name])
        warm = statistics.median(next(row["medianMs"] for row in report["results"]
                                     if (row["stories"], row["scenario"]) == (100, "initial")) for report in reports[name])
        lines.append(f"| {arm['revision']} | {name} | {startup:.2f} | {warm:.2f} | {format(arm['artifactBytes'] / 1048576, '.2f') if 'artifactBytes' in arm else '—'} |")
    lines += ["", "Unavailable modes: " + ", ".join(unavailable), "Evaluation failures: " + ", ".join(failures), "",
              "Complete per-operation effects, intervals, corrected p-values, build logs/provenance and raw samples are in execution-summary.json and per-process reports."]
    markdown = "\n".join(lines) + "\n"
    (destination / "execution-summary.md").write_text(markdown)
    print(markdown)
    if failures:
        raise SystemExit("One or more built modes failed correctness; excluded from timing, see evaluationFailures")


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        self_test()
    else:
        main()

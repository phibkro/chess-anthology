"""Build/evaluate LSP delivery modes, then run paired fresh-server editor workloads."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import random
import shutil
import statistics
import sys
import time

sys.dont_write_bytecode = True
from execution_modes import controlled_environment, failure_output, make_sea, run, sha
from lsp_suite import run_session
from runtime_compare import holm, inference

ROOT = Path(__file__).resolve().parents[3]
TS = ROOT / "prototypes/chess-compiler"
GO = ROOT / "prototypes/chess-compiler-go"
NAMES = ["bun-source", "bun-bundle", "bun-executable", "bun-bytecode", "go-native",
         "node-tsx", "node-bundle", "node-sea", "node-sea-cache", "legacy-bun-source"]


def prepare(destination, requested, baseline):
    arms, builds, unavailable = {}, {}, {}
    bun, node, go = shutil.which("bun"), shutil.which("node"), shutil.which("go")
    if baseline and run(["git", "rev-parse", "HEAD"], baseline).stdout.strip() != "f2068c0d8ab86c80706fa59867e127101fa51fae":
        raise ValueError("Historical Node control requires pinned revision f2068c0d8ab86c80706fa59867e127101fa51fae")
    env = controlled_environment(os.environ)
    (destination / "node-lsp.cjs").unlink(missing_ok=True)
    def add(name, command, cwd, revision, artifact=None):
        arms[name] = {"command": [str(v) for v in command], "cwd": str(cwd), "revision": revision}
        if artifact:
            arms[name].update(artifactBytes=artifact.stat().st_size, artifactDigest=sha(artifact))
    def build(name, command, cwd):
        start = time.perf_counter()
        try:
            result = run(command, cwd, env)
            builds[name] = {"seconds": time.perf_counter() - start, "stdout": result.stdout, "stderr": result.stderr}
            return True
        except Exception as error:
            unavailable[name] = failure_output(error)
            return False
    commit = run(["git", "rev-parse", "HEAD"], ROOT).stdout.strip()
    for name in requested:
        if name.startswith("bun-"):
            if not bun:
                unavailable[name] = {"reason": "Bun not installed"}; continue
            if name == "bun-source":
                add(name, [bun, "src/adapters/lsp.ts", "--stdio"], TS, commit); continue
            artifact = destination / (name + (".mjs" if name == "bun-bundle" else ""))
            flags = ["--target=bun", "--format=esm", "--outfile=" + str(artifact)]
            if name != "bun-bundle": flags.append("--compile")
            if name == "bun-bytecode": flags.append("--bytecode")
            if build(name, [bun, "build", "src/adapters/lsp.ts", *flags], TS):
                add(name, ([bun, artifact] if name == "bun-bundle" else [artifact]) + ["--stdio"], TS, commit, artifact)
        elif name == "go-native":
            artifact = destination / name
            if not go:
                unavailable[name] = {"reason": "Go not installed"}; continue
            if build(name, [go, "build", "-trimpath", "-o", artifact, "./cmd/chess-lsp"], GO):
                add(name, [artifact], GO, commit, artifact)
        else:
            if not baseline:
                unavailable[name] = {"reason": "Pass --node-baseline with installed historical Node checkout"}; continue
            directory = baseline / "prototypes/chess-compiler"
            revision = run(["git", "rev-parse", "HEAD"], baseline).stdout.strip()
            entry = directory / "src/adapters/lsp.ts"
            if name == "node-tsx":
                add(name, [node, "--import", "tsx", entry, "--stdio"], directory, revision); continue
            if name == "legacy-bun-source":
                add(name, [bun, entry, "--stdio"], directory, revision); continue
            bundle = destination / "node-lsp.cjs"
            if not bundle.exists():
                esbuild = directory / "node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/bin/esbuild"
                if not build("node-bundle", [esbuild, entry, "--bundle", "--platform=node", "--format=cjs", "--outfile=" + str(bundle)], directory):
                    unavailable[name] = unavailable["node-bundle"]; continue
            if name == "node-bundle":
                add(name, [node, bundle, "--stdio"], directory, revision, bundle); continue
            artifact = destination / name
            log = []
            start = time.perf_counter()
            try:
                make_sea(node, bundle, artifact, name == "node-sea-cache", log)
                builds[name] = {"seconds": time.perf_counter() - start, "log": log}
                add(name, [artifact, "--stdio"], directory, revision, artifact)
            except Exception as error:
                unavailable[name] = failure_output(error)
    return arms, builds, unavailable


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "report/lsp")
    parser.add_argument("--node-baseline", type=Path)
    parser.add_argument("--arms", default="bun-source,go-native")
    parser.add_argument("--blocks", type=int, default=16)
    parser.add_argument("--sizes", default="1,10,100")
    parser.add_argument("--iterations", type=int, default=5)
    parser.add_argument("--eval-only", action="store_true")
    args = parser.parse_args()
    if not 3 <= args.blocks <= 16 or args.iterations < 1:
        parser.error("blocks must be 3..16 and iterations positive")
    requested = NAMES if args.arms == "all" else args.arms.split(",")
    if set(requested) - set(NAMES): parser.error("Unknown arm")
    sizes = [int(s) for s in args.sizes.split(",")]
    if not sizes or any(s < 1 for s in sizes): parser.error("sizes must be positive")
    destination = args.output.resolve()
    destination.mkdir(parents=True, exist_ok=True)
    arms, builds, unavailable = prepare(destination, requested, args.node_baseline.resolve() if args.node_baseline else None)
    env = controlled_environment(os.environ)
    evaluations, eligible = {}, []
    for name, arm in arms.items():
        historical = name.startswith(("node-", "legacy-"))
        try:
            common = run_session(arm["command"], arm["cwd"], destination / "evaluation" / name / "common",
                                 iterations=2, extended=False, env=env, versioned=not historical)
            try:
                extended = run_session(arm["command"], arm["cwd"], destination / "evaluation" / name / "extended",
                                       iterations=1, extended=True, env=env, versioned=not historical)
            except Exception as error:
                extended = {"fatal": str(error)}
            evaluations[name] = {"common": common, "extended": extended}
            common_failures = {k: v for k, v in common["failures"].items() if k != "versioned-diagnostics"}
            if not common_failures and (historical or not extended.get("fatal") and not extended["failures"]):
                eligible.append(name)
            print(name, "common gaps", list(common["failures"]), "extended gaps", extended.get("failures", extended.get("fatal")), flush=True)
        except Exception as error:
            evaluations[name] = {"fatal": str(error)}
            print(name, "failed", str(error), flush=True)
    report = {"schema": 1, "arms": arms, "builds": builds, "unavailable": unavailable,
              "evaluations": evaluations, "platform": platform.platform(), "python": sys.version,
              "runtimeVersions": {name: run([binary, "version" if name == "go" else "--version"], ROOT).stdout.strip() for name in ["bun", "node", "go"] if (binary := shutil.which(name))},
              "dirty": bool(run(["git", "status", "--porcelain"], ROOT).stdout),
              "harnessDigest": hashlib.sha256(b"".join((TS / "evaluation" / file).read_bytes() for file in ["lsp_compare.py", "lsp_suite.py", "lsp_client.py", "runtime_compare.py", "execution_modes.py"])).hexdigest(),
              "lockDigests": {"current": sha(TS / "pnpm-lock.yaml"), "go": sha(GO / "go.sum"), "historical": sha(args.node_baseline / "prototypes/chess-compiler/pnpm-lock.yaml") if args.node_baseline else None},
              "sourceDigest": hashlib.sha256(b"".join(p.read_bytes() for folder in [TS / "src", GO] for p in sorted(folder.rglob("*")) if p.is_file() and p.suffix in [".go", ".ts"])).hexdigest(),
              "method": {"blocks": args.blocks, "sizes": sizes, "iterations": args.iterations, "seed": 20261103,
                         "unit": "median within one fresh server process; paired across blocks", "historicalNode": "frozen separate revision; missing versioned diagnostics accepted only for historical comparisons", "startup": "firstDiagnostics includes process launch, initialize, workspace discovery, open and diagnostics; initialize alone differs in indexing timing", "nativeAOT": "Bun executable/bytecode are packaging/JSC bytecode, not native AOT"}}
    (destination / "evaluation.json").write_text(json.dumps(report, indent=2))
    required = [n for n in requested if not n.startswith(("node-", "legacy-"))]
    if not eligible or any(n not in eligible for n in required) or any(n not in eligible for n in arms):
        raise SystemExit("Maintained LSP failed acceptance; see evaluation.json")
    if args.eval_only:
        return
    samples = {n: [] for n in eligible}
    schedule = []
    rng = random.Random(20261103)
    # Rotated shuffled orders balance arm placement without factorial materialization.
    order = eligible[:]
    rng.shuffle(order)
    for block in range(args.blocks):
        if block and block % len(order) == 0:
            rng.shuffle(order)
        offset = block % len(order)
        current = order[offset:] + order[:offset]
        schedule.append(current)
        for name in current:
            arm = arms[name]
            record = {}
            for size in sizes:
                result = run_session(arm["command"], arm["cwd"], destination / "timed-workspace", size=size,
                                     iterations=args.iterations, extended=not name.startswith(("node-", "legacy-")), env=env,
                                     versioned=not name.startswith(("node-", "legacy-")))
                failures = {k: v for k, v in result["failures"].items() if k != "versioned-diagnostics"}
                if failures:
                    raise AssertionError((name, failures))
                record[str(size)] = {k: statistics.median(v) for k, v in result["timingsMs"].items()}
            samples[name].append(record)
        print("block", block + 1, "/", args.blocks, flush=True)
        (destination / "samples.json").write_text(json.dumps({"schedule": schedule, "samples": samples}, indent=2))
    medians = {name: {str(size): {metric: statistics.median(row[str(size)][metric] for row in rows)
                                for metric in rows[0][str(size)]} for size in sizes} for name, rows in samples.items()}
    comparisons = []
    if "bun-source" in samples:
        for name in samples:
            if name == "bun-source": continue
            for size in sizes:
                for metric in medians[name][str(size)]:
                    row = {"reference": "bun-source", "candidate": name, "size": size, "metric": metric,
                           **inference([r[str(size)][metric] for r in samples["bun-source"]], [r[str(size)][metric] for r in samples[name]])}
                    comparisons.append(row)
        holm(comparisons)
    report.update(mediansMs=medians, comparisons=comparisons, schedule=schedule)
    (destination / "report.json").write_text(json.dumps(report, indent=2))
    lines = ["# LSP measurements", "", "Median milliseconds across fresh server processes. Full protocol transcripts and raw samples accompany this report.", "", "| Mode | Stories | First diagnostics | Prose edit | Recovery | Completion | Definition |", "|---|---:|---:|---:|---:|---:|---:|"]
    for name, rows in medians.items():
        for size, row in rows.items():
            lines.append(f"| {name} | {size} | " + " | ".join(f"{row[k]:.3f}" for k in ["firstDiagnostics", "proseEdit", "recovery", "completion", "definition"]) + " |")
    lines += ["", "Historical Node is a separate frozen compiler revision and has explicitly recorded feature gaps. These are whole-server comparisons, not isolated language/runtime effects.", "", "Bun executable builds package JavaScriptCore; bytecode builds precompile JavaScript bytecode. Neither is native ahead-of-time compilation."]
    (destination / "report.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()

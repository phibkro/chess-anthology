"""Paired fresh-process runtime experiment; project dependencies remain managed by pnpm."""
import itertools
import json
import math
import os
from pathlib import Path
import random
import statistics
import subprocess
import sys
import time


def inference(before, after, seed=20261102):
    if len(before) != len(after) or len(before) < 3:
        raise ValueError("At least three paired process measurements are required")
    if any(not math.isfinite(x) or x <= 0 for x in before + after):
        raise ValueError("Latency observations must be positive and finite")
    differences = [math.log(b / a) for a, b in zip(before, after)]
    effect = statistics.mean(differences)
    observed = abs(sum(differences))
    extreme = sum(abs(sum(sign * x for sign, x in zip(signs, differences))) >= observed - 1e-12
                  for signs in itertools.product((-1, 1), repeat=len(differences)))
    rng = random.Random(seed)
    bootstrap = sorted(math.exp(statistics.mean(rng.choices(differences, k=len(differences)))) for _ in range(10000))
    return {"ratio": math.exp(effect), "ci95": [bootstrap[249], bootstrap[9749]], "p": extreme / (2 ** len(differences))}


def holm(rows):
    highest = 0.0
    for rank, row in enumerate(sorted(rows, key=lambda item: item["p"])):
        highest = max(highest, min(1.0, row["p"] * (len(rows) - rank)))
        row["adjustedP"] = highest
        row["detectable"] = highest < 0.05


def experiment_plan(base, current, bun_era):
    if bun_era:
        return ({"base-bun": (base, ["bun"]), "current-bun": (current, ["bun"])},
                [("PR change", "base-bun", "current-bun")])
    return ({"base-node": (base, ["node", "--import", "tsx"]),
             "base-bun": (base, ["bun"]), "migrated-bun": (current, ["bun"])},
            [("Runtime only", "base-node", "base-bun"),
             ("Full migration", "base-node", "migrated-bun"),
             ("Bun code changes", "base-bun", "migrated-bun")])


def self_test():
    same = inference([1.0] * 12, [1.0] * 12)
    assert same["ratio"] == 1.0 and same["p"] == 1.0
    faster = inference([2.0] * 12, [1.0] * 12)
    assert faster["ratio"] == 0.5 and faster["ci95"] == [0.5, 0.5]
    rows = [same, faster]
    holm(rows)
    assert not same["detectable"] and faster["detectable"]
    mixed = inference([1.0] * 12, [2.0, 0.5] * 6)
    assert mixed["p"] == 1.0
    try:
        inference([0.0] * 3, [1.0] * 3)
    except ValueError:
        pass
    else:
        raise AssertionError("Invalid measurements accepted")
    bun_arms, bun_comparisons = experiment_plan(Path("base"), Path("current"), True)
    assert len(bun_arms) == 2 and len(bun_comparisons) == 1
    assert all(command == ["bun"] for _, command in bun_arms.values())
    legacy_arms, legacy_comparisons = experiment_plan(Path("base"), Path("current"), False)
    assert len(legacy_arms) == 3 and len(legacy_comparisons) == 3
    print("Runtime inference and runtime-selection self-tests passed")


def main():
    base, current, destination = [Path(value).resolve() for value in sys.argv[1:4]]
    destination.mkdir(parents=True, exist_ok=True)
    blocks = int(os.environ.get("CHESS_RUNTIME_BLOCKS", "12"))
    if not 3 <= blocks <= 16:
        raise ValueError("CHESS_RUNTIME_BLOCKS must be 3..16 (exact paired permutation test)")
    env = dict(os.environ, CHESS_BENCH_ITERATIONS=os.environ.get("CHESS_BENCH_ITERATIONS", "5"),
               CHESS_BENCH_WARMUPS=os.environ.get("CHESS_BENCH_WARMUPS", "2"),
               CHESS_BENCH_SIZES=os.environ.get("CHESS_BENCH_SIZES", "1,10,100"))
    package = json.loads((base / "package.json").read_text())
    bun_era = "bun" in package.get("engines", {})
    arms, comparisons = experiment_plan(base, current, bun_era)
    versions = {name: subprocess.check_output([cmd[0], "--version"], text=True).strip() for name, (_, cmd) in arms.items()}
    # Correctness is checked outside all timed child-process experiments.
    for name, (directory, command) in arms.items():
        result = subprocess.run(command + ["evaluation/evaluate.mts"], cwd=directory, env=env, capture_output=True, text=True, timeout=180, check=True)
        (destination / f"{name}-evaluation.json").write_text(result.stdout)
    reports = {name: [] for name in arms}
    schedule = []
    permutations = list(itertools.permutations(arms))
    rng = random.Random(20261102)
    for block in range(blocks):
        if block % len(permutations) == 0:
            rng.shuffle(permutations)
        order = permutations[block % len(permutations)]
        schedule.append(list(order))
        for name in order:
            directory, command = arms[name]
            started = time.perf_counter()
            result = subprocess.run(command + ["evaluation/benchmark.mts"], cwd=directory, env=env, capture_output=True, text=True, timeout=180, check=True)
            elapsed = time.perf_counter() - started
            report = json.loads(result.stdout)
            report["experimentRuntime"] = versions[name]
            report["processWallSeconds"] = elapsed
            (destination / f"{name}-{block:02}.json").write_text(json.dumps(report, indent=2) + "\n")
            reports[name].append(report)
    references = [report for runs in reports.values() for report in runs]
    for key in ("corpusDigest", "iterations", "warmups"):
        if len({str(report[key]) for report in references}) != 1:
            raise ValueError(f"Incomparable measurement setting: {key}")
    if not bun_era:
        for left, right in zip(reports["base-node"], reports["base-bun"]):
            for key in ("compilerCommit", "harnessDigest", "lockDigest"):
                if left[key] != right[key]:
                    raise ValueError(f"Runtime-only comparison differs in {key}")
    elif len({report["harnessDigest"] for report in references}) != 1:
        raise ValueError("Bun PR comparison requires the same harness in both worktrees")
    indexed = {name: [{(row["stories"], row["scenario"]): row for row in report["results"]} for report in runs] for name, runs in reports.items()}
    keys = next(iter(indexed.values()))[0].keys()
    if any(run.keys() != keys for runs in indexed.values() for run in runs):
        raise ValueError("Different scenario sets")
    rows = []
    for label, before_arm, after_arm in comparisons:
        for stories, scenario in keys:
            before = [run[(stories, scenario)]["medianMs"] for run in indexed[before_arm]]
            after = [run[(stories, scenario)]["medianMs"] for run in indexed[after_arm]]
            row = {"comparison": label, "stories": stories, "scenario": scenario, "beforeMs": statistics.median(before), "afterMs": statistics.median(after), **inference(before, after)}
            rows.append(row)
    holm(rows)
    summary = {"format": "chess-runtime-comparison", "version": 1, "mode": "bun-pr" if bun_era else "node-to-bun", "blocks": blocks, "schedule": schedule, "seed": 20261102, "versions": versions, "independentUnit": "One fresh process per arm per block; inference uses paired per-process medians, not within-process samples", "method": "Geometric mean paired latency ratio, paired percentile-bootstrap nominal 95% CI (10000 resamples); exact two-sided sign-flip test on log ratios; Holm correction across every reported scenario/comparison", "rows": rows}
    (destination / "runtime-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    lines = ["### Bun PR benchmark" if bun_era else "### Node → Bun runtime experiment", "", f"{blocks} paired process blocks; ratios below 1 favor the after arm. CI is nominal 95%; significance uses Holm-adjusted p < 0.05 across all {len(rows)} comparisons.", "", ("The same harness runs under Bun for both PR revisions. Code and dependency changes are part of this comparison. " if bun_era else "Runtime only runs identical baseline code and dependencies. Full migration also includes Bun API and lint-driven code changes. ") + "Fixed machine, seeded balanced arm order, no concurrent benchmark jobs within this experiment. Shared-runner noise remains possible; statistical detectability does not establish practical importance.", "", "| Comparison | Stories | Operation | Before ms | After ms | Ratio [95% CI] | Adjusted p | Detectable |", "| --- | ---: | --- | ---: | ---: | --- | ---: | --- |"]
    for row in rows:
        lo, hi = row["ci95"]
        lines.append(f"| {row['comparison']} | {row['stories']} | {row['scenario']} | {row['beforeMs']:.3f} | {row['afterMs']:.3f} | {row['ratio']:.2f} [{lo:.2f}, {hi:.2f}] | {row['adjustedP']:.4f} | {'yes' if row['detectable'] else 'uncertain'} |")
    text = "\n".join(lines) + "\n"
    (destination / "runtime-summary.md").write_text(text)
    print(text)


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        self_test()
    else:
        main()

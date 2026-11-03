"""Summarize paired benchmark reports; timing ratios are observations, never gates."""
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    baseline = json.load(handle)
with open(sys.argv[2], encoding="utf-8") as handle:
    current = json.load(handle)
for key in ("format", "version", "harnessDigest", "corpusDigest", "iterations", "warmups", "environment"):
    if baseline[key] != current[key]:
        raise ValueError(f"Incomparable benchmark reports: {key}")
old = {(row["stories"], row["scenario"]): row for row in baseline["results"]}
new = {(row["stories"], row["scenario"]): row for row in current["results"]}
if old.keys() != new.keys():
    raise ValueError("Incomparable benchmark scenario sets")
print("### Chess compiler benchmarks\n")
print("Timing observations only; shared-runner noise and fixed run order can affect ratios.\n")
print(f"Base: `{baseline['compilerCommit']}` (dirty: {baseline['compilerDirty']}); current: `{current['compilerCommit']}` (dirty: {current['compilerDirty']}).\n")
print("| Stories | Operation | Base median (ms) | Current median (ms) | Current / base |")
print("| --- | --- | ---: | ---: | ---: |")
for key, row in new.items():
    before = old[key]["medianMs"]
    ratio = f"{row['medianMs'] / before:.2f}×" if before > 0 else "n/a"
    print(f"| {row['stories']} | {row['scenario']} | {before:.3f} | {row['medianMs']:.3f} | {ratio} |")

"""Compare retained JSC heap and serialized playback using identical fresh-process workloads."""
import hashlib
import json
import os
import platform
from pathlib import Path
import shutil
import statistics
import subprocess
import sys
import tempfile


def main():
    baseline, candidate, output = [Path(arg).resolve() for arg in sys.argv[1:4]]
    output.mkdir(parents=True, exist_ok=True)
    harness = Path(__file__).with_name("memory.mts")
    report = {"method": "Three fresh processes per mode/revision; forced full GC and sweep before samples. Retained JSC heap, not cumulative allocation or peak RSS. No performance significance claim.",
              "harnessDigest": hashlib.sha256(harness.read_bytes()).hexdigest(), "samples": {}, "medians": {}, "identities": {}, "platform": platform.platform(), "python": sys.version}
    bun = shutil.which("bun")
    if bun is None:
        raise RuntimeError("Bun is required")
    report["bun"] = subprocess.check_output([bun, "--version"], text=True).strip()
    for name, directory in [("baseline", baseline), ("candidate", candidate)]:
        report["identities"][name] = {"commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=directory, text=True).strip(),
            "lockDigest": hashlib.sha256((directory / "pnpm-lock.yaml").read_bytes()).hexdigest(),
            "fixtureDigest": hashlib.sha256((directory / "examples/opera.pgn").read_bytes()).hexdigest(),
            "dirty": bool(subprocess.check_output(["git", "status", "--porcelain", "--", "src", "package.json", "pnpm-lock.yaml", "examples/opera.pgn"], cwd=directory, text=True).strip()),
            "sourceDigest": hashlib.sha256(b"".join(str(p.relative_to(directory)).encode() + b"\0" + p.read_bytes() for p in sorted((directory / "src").rglob("*.ts")))).hexdigest()}
        with tempfile.TemporaryDirectory(prefix="chess-memory-") as folder:
            stage = Path(folder)
            (stage / "src").symlink_to(directory / "src", target_is_directory=True)
            (stage / "examples").symlink_to(directory / "examples", target_is_directory=True)
            (stage / "evaluation").mkdir()
            worker = stage / "evaluation/memory.mts"
            shutil.copyfile(harness, worker)
            modes = {}
            for mode in ["unchanged", "prose", "pgn"]:
                rows = []
                for repetition in range(3):
                    result = subprocess.run([bun, str(worker), mode], cwd=directory, env=os.environ, capture_output=True, text=True, check=True, timeout=120)
                    rows.append(json.loads(result.stdout))
                modes[mode] = rows
            report["samples"][name] = modes
            report["medians"][name] = {mode: {"initialHeap": statistics.median(row["samples"][0]["heapSize"] for row in rows),
                "finalHeap": statistics.median(row["samples"][-1]["heapSize"] for row in rows),
                "finalObjects": statistics.median(row["samples"][-1]["objectCount"] for row in rows),
                "playbackBytes": statistics.median(row["playbackBytes"] for row in rows),
                "storedFrames": statistics.median(row["storedFrames"] for row in rows)} for mode, rows in modes.items()}
    (output / "results.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report["medians"], indent=2))


if __name__ == "__main__":
    main()

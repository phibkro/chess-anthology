import { createCompiler } from "../src/compiler/index.js";
/* eslint-disable no-await-in-loop -- Workspace updates and timing samples must execute sequentially; concurrency changes their semantics and measurements. */
import type { Result, BuildWork } from "../src/contracts/index.js";
import { assert } from "../src/runtime/assert.js";
import { collectIdentity } from "./identity.mjs";
import type { BenchmarkReport } from "./report-contract.mjs";
import { createWorkload, editWorkload, expectedWork } from "./workload.mjs";

const value = <T,>(result: Result<T>): T => {
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
};
const iterations = Number(process.env.CHESS_BENCH_ITERATIONS ?? 10);
const warmups = Number(process.env.CHESS_BENCH_WARMUPS ?? 3);
const sizes = (process.env.CHESS_BENCH_SIZES ?? "1,10,100")
  .split(",")
  .map(Number);
assert.ok(
  Number.isSafeInteger(iterations) && iterations >= 3 && iterations <= 1000,
  "Iterations must be between 3 and 1000."
);
assert.ok(
  Number.isSafeInteger(warmups) && warmups >= 0 && warmups <= 100,
  "Warmups must be between 0 and 100."
);
assert.ok(
  sizes.length > 0 &&
    sizes.every(
      (size) => Number.isSafeInteger(size) && size > 0 && size <= 10_000
    ),
  "Sizes must be positive story counts up to 10000."
);
const results = [];
const corpusHash = new Bun.CryptoHasher("sha256");
for (const stories of sizes) {
  const sources = createWorkload(stories);
  corpusHash.update(JSON.stringify([...sources]));
  for (const scenario of [
    "initial",
    "unchanged",
    "prose",
    "shared-game",
  ] as const) {
    const samplesMs = [];
    const rssBytes = [];
    let work: BuildWork | null = null;
    for (let sample = -warmups; sample < iterations; sample += 1) {
      // Preparation and all correctness checks are deliberately outside the timed interval.
      const compiler = scenario === "initial" ? undefined : createCompiler();
      if (compiler) {
        value(await compiler.update(sources));
      }
      const next =
        scenario === "initial"
          ? sources
          : editWorkload(sources, scenario, sample + warmups);
      const started = performance.now();
      const result = await (compiler ?? createCompiler()).update(next);
      const elapsed = performance.now() - started;
      const update = value(result);
      ({ work } = update);
      assert.equal(update.snapshot.output.length, stories + 1);
      assert.ok(
        update.snapshot.output.every(
          (document) => document.diagnostics.length === 0
        )
      );
      const expected = expectedWork(stories, scenario);
      assert.deepEqual(work, expected);
      if (sample >= 0) {
        samplesMs.push(elapsed);
        rssBytes.push(process.memoryUsage().rss);
      }
    }
    const sorted = samplesMs.toSorted((a, b) => a - b);
    const medianMs =
      ((sorted[Math.floor((sorted.length - 1) / 2)] ?? 0) +
        (sorted[Math.ceil((sorted.length - 1) / 2)] ?? 0)) /
      2;
    results.push({
      medianMs,
      p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0,
      rssBytes,
      samplesMs,
      scenario,
      stories,
      work: work ?? null,
    });
  }
}
console.log(
  JSON.stringify(
    {
      ...(await collectIdentity()),
      corpusDigest: corpusHash.digest("hex"),
      format: "chess-compiler-benchmark",
      iterations,
      memoryScope:
        "RSS observations are process-wide, include untimed preparation, and are not per-operation allocations.",
      processPeakRssBytes: process.resourceUsage().maxRSS * 1024,
      results,
      timingScope:
        "Warm process; initial measures fresh compiler creation and build. Incremental measurements exclude initial population. Module loading and process startup are excluded.",
      version: 2,
      warmups,
    } satisfies BenchmarkReport,
    null,
    2
  )
);

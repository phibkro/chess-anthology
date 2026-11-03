import { gcAndSweep, heapStats } from "bun:jsc";

import { createCompiler, createPlaybackPlan } from "../src/compiler/index.js";

const mode = process.argv[2] ?? "pgn";
if (!["unchanged", "prose", "pgn"].includes(mode)) {
  throw new Error("Unknown memory workload.");
}
const game = "file:///memory/game.pgn";
const story = "file:///memory/story.chess-story";
const pgn = await Bun.file(
  new URL("../examples/opera.pgn", import.meta.url)
).text();
const narrative = (boards: number) =>
  `module memory; game opera from "./game.pgn"; story lesson {${Array.from({ length: boards }, (_, i) => `board board${i} game opera after 30 { text "Initial"; }`).join("\n")}}`;
const sources = new Map([
  [game, pgn],
  [story, narrative(1)],
]);
const compiler = createCompiler();
const samples = [];
for (let edit = 0; edit <= 200; edit += 1) {
  if (edit > 0 && mode === "pgn") {
    sources.set(
      game,
      pgn.replace(/\[Event "[^"]*"\]/u, `[Event "Revision ${edit}"]`)
    );
  }
  if (edit > 0 && mode === "prose") {
    sources.set(story, narrative(1).replace("Initial", `Revision ${edit}`));
  }
  // oxlint-disable-next-line no-await-in-loop -- Updates are dependent revisions of one persistent compiler.
  const result = await compiler.update(sources);
  if (
    !result.ok ||
    result.value.snapshot.output.some((document) =>
      document.diagnostics.some((issue) => issue.severity === 1)
    )
  ) {
    throw new Error("Invalid memory workload.");
  }
  if ([0, 50, 100, 200].includes(edit)) {
    gcAndSweep();
    const stats = heapStats();
    samples.push({
      edit,
      heapSize: stats.heapSize,
      objectCount: stats.objectCount,
    });
  }
}
const repeated = await createCompiler().update(
  new Map([
    [game, pgn],
    [story, narrative(100)],
  ])
);
if (!repeated.ok) {
  throw new Error(repeated.error.message);
}
const plan = createPlaybackPlan(repeated.value.snapshot, story, "lesson");
if (!plan.ok) {
  throw new Error(plan.error.message);
}
const json = JSON.stringify(plan.value);
console.log(
  JSON.stringify({
    mode,
    playbackBytes: new TextEncoder().encode(json).byteLength,
    samples,
    storedFrames: [...json.matchAll(/"fen":/gu)].length,
  })
);

import { test } from "bun:test";

import legacy from "../evaluation/corpus/playback-v1.json" with { type: "json" };
import { createCompiler, createPlaybackPlan } from "./compiler/index.js";
import type { Result } from "./contracts/index.js";
import { parsePlaybackPlan, playbackFrames } from "./contracts/playback.js";
import { assert } from "./runtime/assert.js";
import { retainGameSources } from "./runtime/source-retention.js";

const value = <T>(result: Result<T>): T => {
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
};
const game = "file:///memory/game.pgn";
const story = "file:///memory/story.chess-story";
const initial = '[Event "Original"]\n\n1. e4 e5 2. Nf3 Nc6 *';
const source = (path = "./game.pgn", boards = 1) =>
  `module memory; game example from "${path}"; story lesson {${Array.from({ length: boards }, (_, i) => `board board${i} game example after 0 { text "A thought"; }`).join("\n")}}`;

test("600: caller mutation during an update cannot mix source revisions", async () => {
  const sources = new Map([
    [game, initial],
    [story, source()],
  ]);
  const pending = createCompiler().update(sources);
  sources.set(game, "1. d4 d5 *");
  sources.delete(story);
  const { snapshot } = value(await pending);
  const history = value(snapshot.games[0].result);
  assert.equal(history.frames[1].san, "e4");
  assert.equal(
    snapshot.output[0].occurrences[0].sourceDigest,
    history.sourceDigest
  );
  assert.deepEqual(snapshot.output[0].diagnostics, []);
});

test("400/600: inactive replay budgets bound revisions without invalidating issued snapshots", async () => {
  const compiler = createCompiler({
    cache: { maxInactiveEntries: 2, maxInactivePositions: 10 },
  });
  const sources = new Map([
    [game, initial],
    [story, source()],
  ]);
  const original = value(await compiler.update(sources)).snapshot;
  const saved = JSON.stringify(original);
  for (let i = 0; i < 100; i += 1) {
    sources.set(game, initial.replace("Original", `Revision ${i}`));
    // oxlint-disable-next-line no-await-in-loop -- Each update is a dependent revision of one compiler.
    const updated = value(await compiler.update(sources));
    assert.equal(updated.work.replayed, 1);
    assert.ok(compiler.cacheStats().inactiveEntries <= 2);
    assert.ok(compiler.cacheStats().inactivePositions <= 10);
  }
  assert.equal(JSON.stringify(original), saved);
  sources.set(game, initial);
  assert.equal(value(await compiler.update(sources)).work.replayed, 1);
  assert.deepEqual(value(original.games[0].result).frames[1].san, "e4");
});

test("400/600: active games remain cached even when they exceed inactive budgets", async () => {
  const compiler = createCompiler({
    cache: { maxInactiveEntries: 0, maxInactivePositions: 0 },
  });
  const second = "file:///memory/second.pgn";
  const sources = new Map([
    [game, initial],
    [second, "1. d4 d5 *"],
    [story, source()],
  ]);
  assert.equal(value(await compiler.update(sources)).work.replayed, 2);
  sources.set(story, source().replace("A thought", "Another thought"));
  assert.equal(value(await compiler.update(sources)).work.replayed, 0);
  assert.equal(compiler.cacheStats().entries, 2);
  sources.delete(second);
  await compiler.update(sources);
  assert.equal(compiler.cacheStats().entries, 1);
});

test("300: retargeted dependencies stop invalidating former importers", async () => {
  const compiler = createCompiler();
  const library = "file:///memory/library.chess-story";
  const second = "file:///memory/second.pgn";
  const sources = new Map([
    [game, initial],
    [second, "1. d4 d5 *"],
    [library, 'module library; export game example from "./game.pgn";'],
    [
      story,
      'module memory; import "./library.chess-story"; story lesson { board first game example after 0 {} }',
    ],
  ]);
  value(await compiler.update(sources));
  sources.set(
    library,
    'module library; export game example from "./second.pgn";'
  );
  value(await compiler.update(sources));
  sources.delete(game);
  assert.equal(value(await compiler.update(sources)).work.emitted, 0);
  sources.set(second, "1. c4 e5 *");
  assert.deepEqual(value(await compiler.update(sources)).work, {
    emitted: 2,
    parsed: 0,
    replayed: 1,
  });
});

test("500: scenes share one history; legacy plans normalize and references are checked", async () => {
  const { snapshot } = value(
    await createCompiler().update(
      new Map([
        [game, initial],
        [story, source("./game.pgn", 100)],
      ])
    )
  );
  const plan = value(createPlaybackPlan(snapshot, story, "lesson"));
  assert.equal(plan.version, 2);
  assert.equal(Object.keys(plan.histories).length, 1);
  assert.equal(
    playbackFrames(plan, plan.scenes[0]),
    playbackFrames(plan, plan.scenes[99])
  );
  assert.equal("frames" in plan.scenes[0], false);
  const restored = value(parsePlaybackPlan(legacy));
  assert.equal(restored.version, 2);
  assert.deepEqual(
    playbackFrames(restored, restored.scenes[0]),
    legacy.scenes[0].frames
  );
  const damaged = structuredClone(plan);
  damaged.scenes[0].historyId = "absent";
  assert.equal(parsePlaybackPlan(damaged).ok, false);
  const conflicting = structuredClone(legacy);
  conflicting.scenes[1].sourceDigest = conflicting.scenes[0].sourceDigest;
  assert.equal(parsePlaybackPlan(conflicting).ok, false);
});

test("400: source-byte budgets also bound inactive records with large metadata", async () => {
  const compiler = createCompiler({ cache: { maxInactiveSourceBytes: 64 } });
  const sources = new Map([
    [game, initial.replace("Original", "x".repeat(1000))],
    [story, source()],
  ]);
  value(await compiler.update(sources));
  sources.set(game, initial);
  value(await compiler.update(sources));
  assert.equal(compiler.cacheStats().inactiveEntries, 0);
  assert.equal(compiler.cacheStats().inactiveSourceBytes, 0);
});

test("editor retirement protects current references and buffers, then releases orphan text", () => {
  const sources = new Map([
    ["file:///old.pgn", "old"],
    ["file:///new.pgn", "new"],
    ["file:///open.pgn", "buffer"],
    [story, source()],
  ]);
  const overlays = new Map([["file:///open.pgn", "buffer"]]);
  const references = new Map([["file:///new.pgn", "./new.pgn"]]);
  let active: string[] = [];
  const activate = (texts: Iterable<string>) => {
    active = [...texts];
  };
  retainGameSources(sources, overlays, references, activate);
  assert.deepEqual(active, ["new", "buffer"]);
  assert.equal(sources.has("file:///old.pgn"), false);
  overlays.clear();
  retainGameSources(sources, overlays, references, activate);
  assert.deepEqual(active, ["new"]);
  assert.equal(sources.has("file:///open.pgn"), false);
  assert.equal(sources.has(story), true);
});

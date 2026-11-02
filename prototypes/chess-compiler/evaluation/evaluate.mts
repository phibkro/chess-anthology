/* eslint-disable no-await-in-loop -- Workspace updates and timing samples must execute sequentially; concurrency changes their semantics and measurements. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  compile,
  createCompiler,
  createPlaybackPlan,
  decode,
  envelope,
  printStructured,
  restore,
  selectPosition,
} from "../src/compiler/index.js";
import type { Result } from "../src/contracts/index.js";
import manifest from "./corpus/manifest.json" with { type: "json" };
import { collectIdentity } from "./identity.mjs";
import type { EvaluationReport } from "./report-contract.mjs";
import { createWorkload, editWorkload, expectedWork } from "./workload.mjs";

const value = <T,>(result: Result<T>): T => {
  if (!result.ok) {
    assert.fail(result.error.message);
  }
  return result.value;
};
const directory = new URL("corpus/", import.meta.url);
const entry = new URL("story.chess-story", directory).href;
const base = new Map(
  await Promise.all(
    ["story.chess-story", ...Object.keys(manifest.provenance)].map(
      async (name) =>
        [
          new URL(name, directory).href,
          await readFile(new URL(name, directory), "utf-8"),
        ] as const
    )
  )
);
const original = base.get(entry) ?? "";
const edits = new Map([
  ["none", original],
  ["syntax", `${original}\n@`],
  ["missing-source", original.replace("./opening.pgn", "./unavailable.pgn")],
  [
    "missing-game",
    original.replace("game opening after 1", "game unavailable after 1"),
  ],
  [
    "missing-position",
    original.replace("game opening after 1", "game opening after 999"),
  ],
  ["illegal-answer", original.replace('answer "e5"', 'answer "e4"')],
  ["invalid-arrow", original.replace('arrow "e2"', 'arrow "z9"')],
  ["illegal-recorded-move", original],
]);
const cases = [];
for (const fixture of manifest.cases) {
  const sources = new Map(base);
  const edited = edits.get(fixture.edit);
  assert.notEqual(edited, undefined, `Unknown edit ${fixture.edit}`);
  sources.set(entry, edited ?? "");
  if (fixture.edit === "illegal-recorded-move") {
    sources.set(new URL("opening.pgn", directory).href, "1. e5 *");
  }
  const snapshot = value(await compile(sources));
  const document = snapshot.output.find((item) => item.uri === entry);
  assert.ok(document);
  const codes = document.diagnostics.map(
    (diagnostic) => diagnostic.code ?? "unclassified"
  );
  for (const code of fixture.diagnostics) {
    assert.ok(
      codes.includes(code),
      `${fixture.id}: expected ${code}; found ${codes.join(", ")}`
    );
  }
  if (fixture.target !== "") {
    const lines = (edited ?? "").split("\n");
    const diagnostic = document.diagnostics.find(
      (item) => item.code === fixture.diagnostics[0]
    );
    assert.ok(diagnostic);
    assert.equal(diagnostic.phase, fixture.phase);
    const { start, end } = diagnostic.range;
    assert.equal(
      start.line,
      end.line,
      "These fixtures deliberately target single-line tokens."
    );
    const selected = (lines[start.line] ?? "").slice(
      start.character,
      end.character
    );
    assert.ok(
      selected.includes(fixture.target),
      `${fixture.id}: unexpected diagnostic span ${selected}`
    );
  }
  if (fixture.diagnostics.length === 0) {
    assert.deepEqual(codes, []);
  }
  for (const diagnostic of document.diagnostics) {
    assert.notEqual(diagnostic.message, "");
    assert.ok(diagnostic.range.start.line >= 0);
    assert.ok(diagnostic.range.end.line >= diagnostic.range.start.line);
  }
  const plan = createPlaybackPlan(snapshot, entry, "contexts");
  assert.equal(plan.ok ? "ok" : plan.error.code, fixture.plan, fixture.id);
  if (fixture.id === "valid-contexts") {
    assert.equal(value(plan).scenes.length, 3);
    for (const expected of manifest.positions) {
      const uri = new URL(expected.game, directory).href;
      const game = snapshot.games.find((item) => item.uri === uri);
      assert.ok(game);
      assert.equal(value(game.result).frames.length, expected.frames);
      assert.equal(
        value(selectPosition(snapshot, uri, expected.ply)).fen,
        expected.fen
      );
    }
    const data = value(decode(original));
    assert.deepEqual(value(decode(value(printStructured(data)))), data);
    assert.equal(value(restore(envelope(data, original))), original);
    const stale = { ...envelope(data, original), sourceText: `${original}\n` };
    assert.equal(restore(stale).ok, false);
    assert.deepEqual(
      value(plan).scenes.map(({ after, game, id, notes }) => ({
        after,
        game,
        id,
        notes,
      })),
      manifest.scenes,
      "Every scene must preserve annotation content, order and resolved prompt moves."
    );
  } else {
    // Authoring recovery: the same compiler must clear stale diagnostics after correction.
    const compiler = createCompiler();
    value(await compiler.update(sources));
    const recovered = value(await compiler.update(base)).snapshot;
    assert.deepEqual(recovered.output, value(await compile(base)).output);
  }
  cases.push({
    diagnostics: document.diagnostics,
    id: fixture.id,
    passed: true,
  });
}
const budgets = [];
for (const stories of [1, 8]) {
  const sources = createWorkload(stories);
  for (const scenario of [
    "initial",
    "unchanged",
    "prose",
    "shared-game",
  ] as const) {
    const compiler = createCompiler();
    if (scenario !== "initial") {
      value(await compiler.update(sources));
    }
    const next =
      scenario === "initial" ? sources : editWorkload(sources, scenario, 1);
    const before = JSON.stringify([...sources]);
    const update = value(await compiler.update(next));
    const expected = expectedWork(stories, scenario);
    assert.deepEqual(update.work, expected, `${scenario}/${stories}`);
    const clean = value(await compile(next));
    assert.deepEqual(update.snapshot.output, clean.output);
    assert.deepEqual(update.snapshot.games, clean.games);
    assert.equal(JSON.stringify([...sources]), before);
    budgets.push({ scenario, stories, work: update.work });
  }
}
const hash = createHash("sha256");
hash.update(JSON.stringify(manifest));
for (const [uri, source] of base) {
  hash
    .update(new URL(uri).pathname.split("/").at(-1) ?? "")
    .update("\0")
    .update(source)
    .update("\0");
}
console.log(
  JSON.stringify(
    {
      ...(await collectIdentity()),
      budgets,
      cases,
      corpusDigest: hash.digest("hex"),
      format: "chess-compiler-evaluation",
      passed: true,
      version: 1,
    } satisfies EvaluationReport,
    null,
    2
  )
);

/* oxlint-disable unicorn/prefer-structured-clone -- The codec's JSON serialization boundary is under test. */
import { expect, test } from "bun:test";

import * as fc from "fast-check";

import { createCompositionLinker } from "../compiler/300-linking/index.js";
import {
  compile,
  createCompiler,
  createPlaybackPlan,
  createPlaybackCollection,
  decode,
  printStructured,
  envelope,
  restore,
} from "../compiler/index.js";
import { parsePlaybackCollection } from "../contracts/collection.js";
import type { Result } from "../contracts/index.js";
import { createProjectCompiler } from "../sources/index.js";

const value = <T>(result: Result<T>): T => {
  if (!result.ok) {
    throw new Error(JSON.stringify(result.error));
  }
  return result.value;
};
const root = new URL("../../examples/composition/", import.meta.url);
const files = new Map(
  await Promise.all(
    [
      "opera.chess.md",
      "reti.chess.md",
      "collection.chess.md",
      "remix.chess.md",
      "../opera.pgn",
      "../reti.pgn",
    ].map(
      async (path) =>
        [
          new URL(path, root).href,
          await Bun.file(new URL(path, root)).text(),
        ] as const
    )
  )
);
const collection = new URL("collection.chess.md", root).href;
const remix = new URL("remix.chess.md", root).href;
const opera = new URL("opera.chess.md", root).href;

const clean = async (sources = files) => {
  const snapshot = value(await compile(sources));
  expect(snapshot.output.flatMap((document) => document.diagnostics)).toEqual(
    []
  );
  return snapshot;
};

test("one story stands alone, groups into nested collections and destructures by named member", async () => {
  const snapshot = await clean();
  const standalone = value(createPlaybackPlan(snapshot, opera, "opera"));
  const grouped = value(
    createPlaybackCollection(snapshot, collection, "encore")
  );
  expect(grouped.stories.map((story) => story.id)).toEqual([
    "queen-offers/opera",
    "queen-offers/reti",
    "opera-again",
  ]);
  expect(grouped.stories[0].plan.scenes).toEqual(standalone.scenes);
  const extracted = value(createPlaybackPlan(snapshot, remix, "selected"));
  const fromCollection = value(
    createPlaybackPlan(snapshot, collection, "queen-offers/reti")
  );
  expect(extracted.scenes).toEqual(fromCollection.scenes);
  expect(
    value(createPlaybackCollection(snapshot, remix, "reversed")).stories.map(
      (story) => story.id
    )
  ).toEqual(["first", "second"]);
  expect(
    value(parsePlaybackCollection(JSON.parse(JSON.stringify(grouped))))
  ).toEqual(grouped);
});

test("story inclusion preserves source game scope, order and separate occurrence identities", async () => {
  const snapshot = await clean();
  const plan = value(createPlaybackPlan(snapshot, remix, "remix"));
  expect(plan.scenes.map((scene) => scene.id)).toEqual([
    "opening/finish",
    "comparison/finish",
    "reprise/finish",
  ]);
  expect(plan.scenes.map((scene) => scene.after)).toEqual([30, 16, 30]);
  expect(
    plan.scenes.map(
      (scene) =>
        scene.notes.flatMap((note) =>
          note.type === "prompt" ? [note.answer] : []
        )[0]
    )
  ).toEqual(["Qb8+", "Qd8+", "Qb8+"]);
  expect(plan.scenes[0].sourceDigest).toBe(plan.scenes[2].sourceDigest);
  expect(plan.scenes[0].sourceDigest).not.toBe(plan.scenes[1].sourceDigest);
  expect(Object.keys(plan.histories)).toHaveLength(2);
});

test("composition codecs retain references instead of flattening or copying authored stories", () => {
  fc.assert(
    fc.property(fc.integer({ max: 8, min: 1 }), (count) => {
      const uses = Array.from(
        { length: count },
        (_, index) => `@include nets/opera as occurrence-${index}`
      ).join("\n\n");
      const source = `---\nid: generated\nuses:\n  nets: ./collection.chess.md#queen-offers\nexports: [generated]\n---\n\n# Generated\n@id generated\n\n${uses}\n`;
      const data = value(decode(source));
      expect(data.formatVersion).toBe(2);
      expect(value(decode(value(printStructured(data))))).toEqual(data);
      expect(
        value(restore(JSON.parse(JSON.stringify(envelope(data, source)))))
      ).toBe(source);
      expect(data.stories[0].scenes).toHaveLength(count);
    }),
    { numRuns: 60, seed: 20_261_104 }
  );
});

test("missing/private exports, bad members and cycles are linking diagnostics", async () => {
  const scenarios = [
    [
      remix,
      "#queen-offers/reti",
      "#queen-offers/missing",
      "link/missing-member",
    ],
    [opera, "exports: [opera]", "exports: []", "link/not-exported"],
    [
      collection,
      "queen-offers: [opera, reti]",
      "queen-offers: [queen-offers]",
      "link/composition-cycle",
    ],
    [
      remix,
      "@include selected as comparison",
      "@include remix as comparison",
      "link/composition-cycle",
    ],
    [
      collection,
      "queen-offers: [opera, reti]",
      "queen-offers: [opera, opera]",
      "semantic/duplicate-member",
    ],
  ];
  await Promise.all(
    scenarios.map(async ([uri, before, after, code]) => {
      const changed = new Map(files).set(
        uri,
        (files.get(uri) ?? "").replace(before, after)
      );
      const snapshot = value(await compile(changed));
      expect(
        snapshot.output
          .flatMap((document) => document.diagnostics)
          .some((diagnostic) => diagnostic.code === code)
      ).toBe(true);
      expect(createPlaybackPlan(snapshot, remix, "remix").ok).toBe(false);
    })
  );
});

test("edits invalidate composed dependents without replaying unchanged PGN", async () => {
  const compiler = createCompiler();
  const first = value(await compiler.update(files));
  const before = value(createPlaybackPlan(first.snapshot, remix, "remix"));
  const changed = new Map(files).set(
    opera,
    (files.get(opera) ?? "").replace("rook and bishop", "bishop and rook")
  );
  const next = value(await compiler.update(changed));
  expect(next.work.replayed).toBe(0);
  expect(next.work.parsed).toBe(1);
  expect(next.work.emitted).toBe(3);
  const after = value(createPlaybackPlan(next.snapshot, remix, "remix"));
  expect(after.scenes[0].notes).not.toEqual(before.scenes[0].notes);
  expect(after.scenes[1].notes).toEqual(before.scenes[1].notes);
  expect(value(createPlaybackPlan(first.snapshot, remix, "remix"))).toEqual(
    before
  );
});

test("project acquisition follows composition bindings and selectors", async () => {
  const project = value(
    await createProjectCompiler().update({ entries: ["remix.chess.md"], root })
  );
  expect(project.snapshot.output).toHaveLength(4);
  expect(
    value(createPlaybackCollection(project.snapshot, remix, "reversed")).stories
  ).toHaveLength(2);
});

test("link validation visits definitions rather than expanding repeated catalog occurrences", () => {
  const levels = 28;
  const definitions = Array.from(
    { length: levels },
    (_, index) =>
      `  c${index + 1}: [{ as: left, use: c${index} }, { as: right, use: c${index} }]`
  ).join("\n");
  const source = `---\nid: catalog\ncollections:\n  c0: [leaf]\n${definitions}\nexports: [c${levels}]\n---\n\n# Leaf\n@id leaf\n`;
  const data = value(decode(source));
  const uri = "file:///catalog.chess.md";
  const linker = createCompositionLinker([{ data, uri }]);
  expect(linker.validate(uri)).toEqual([]);
  expect(linker.validationWork()).toBe(levels + 2);
});

test("cyclic file dependencies are valid when selected story definitions are acyclic", async () => {
  const a = "file:///cycles/a.chess.md";
  const b = "file:///cycles/b.chess.md";
  const first =
    "---\nid: first\nuses:\n  b: ./b.chess.md#b\ngames:\n  score: ./opera.pgn\nexports: [a, leaf]\n---\n\n# A\n@id a\n@include b\n\n# Leaf\n@id leaf\n## Finish\n@board score after 30\n";
  const second =
    "---\nid: second\nuses:\n  leaf: ./a.chess.md#leaf\nexports: [b]\n---\n\n# B\n@id b\n@include leaf\n";
  const snapshot = await clean(
    new Map([
      [a, first],
      [b, second],
      [
        "file:///cycles/opera.pgn",
        files.get(new URL("../opera.pgn", root).href) ?? "",
      ],
    ])
  );
  expect(
    value(createPlaybackPlan(snapshot, a, "a")).scenes.map((scene) => scene.id)
  ).toEqual(["b/leaf/finish"]);
});

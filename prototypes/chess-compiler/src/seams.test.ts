import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve, relative, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import fc from "fast-check";

import type { BuildSnapshot } from "./compiler/index.js";
import {
  compile,
  createCompiler,
  decode,
  envelope,
  restore,
  printStructured,
  selectPosition,
} from "./compiler/index.js";
import { parseStructured, type Result } from "./contracts/index.js";
function value<T>(result: Result<T>): T {
  if (!result.ok) assert.fail(JSON.stringify(result.error));
  return result.value;
}
const seed = Number(process.env.FC_SEED ?? 20261102);
const options = { seed, numRuns: 300 };
const identifier = fc.nat().map((n) => `id_${n}`);
const text = fc.oneof(
  fc.string(),
  fc.constantFrom('a"b', "\\n", "\n", "\r\n", "\u0000", "\ud800", "♞ é")
);
const note = fc.oneof(
  fc.record({ type: fc.constant("text"), text }),
  fc.record({ type: fc.constant("prompt"), text, answer: text }),
  fc.record({
    type: fc.constant("arrow"),
    from: text,
    to: text,
    color: identifier,
  })
);
const authored = fc.record({
  formatVersion: fc.constant(0),
  name: identifier,
  imports: fc.array(text, { maxLength: 3 }),
  games: fc.array(
    fc.record({ name: identifier, exported: fc.boolean(), source: text }),
    {
      maxLength: 3,
    }
  ),
  stories: fc.array(
    fc.record({
      name: identifier,
      scenes: fc.array(
        fc.record({
          name: identifier,
          game: identifier,
          ply: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
          notes: fc.array(note, { maxLength: 4 }),
        }),
        { maxLength: 3 }
      ),
    }),
    { maxLength: 2 }
  ),
});
void test("200 ↔ 500: structured/flat codec preserves every generated authored value", () => {
  fc.assert(
    fc.property(authored, (document) => {
      const checked = value(parseStructured(document));
      assert.deepEqual(value(decode(value(printStructured(checked)))), checked);
    }),
    options
  );
});
void test("100 ↔ 500: source envelopes preserve comments, whitespace, Unicode and line endings", () => {
  fc.assert(
    fc.property(
      authored,
      fc.constantFrom("\n", "\r\n"),
      fc.nat(20),
      (document, newline, spaces) => {
        const source =
          "// retained source" +
          newline +
          " ".repeat(spaces) +
          value(printStructured(document)).replaceAll("\n", newline);
        const data = value(decode(source));
        assert.equal(
          value(restore(JSON.parse(JSON.stringify(envelope(data, source))))),
          source
        );
        const stale = envelope(structuredClone(data), source);
        stale.data = { ...stale.data, name: stale.data.name + "_changed" };
        assert.equal(restore(stale).ok, false);
      }
    ),
    options
  );
});
void test("100 and document seams: bounded malformed input fuzzing returns values, not exceptions", () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 2048 }), (source) => {
      assert.equal(typeof decode(source).ok, "boolean");
      assert.equal(typeof restore(source).ok, "boolean");
    }),
    { ...options, numRuns: 500 }
  );
  fc.assert(
    fc.property(fc.jsonValue(), (data) => {
      assert.equal(typeof parseStructured(data).ok, "boolean");
      assert.equal(typeof printStructured(data).ok, "boolean");
    }),
    options
  );
});
const dir = new URL("../examples/", import.meta.url);
const story = new URL("story.chess-story", dir).href;
const opera = new URL("opera.pgn", dir).href;
async function fixtures() {
  return new Map(
    await Promise.all(
      (await readdir(dir)).map(async (name) => {
        const uri = new URL(name, dir);
        return [uri.href, await readFile(uri, "utf8")] as const;
      })
    )
  );
}
void test("300/400/500/600: reuse, dependency invalidation, immutable history and pure views", async () => {
  const sources = await fixtures();
  sources.set(
    new URL("unrelated.chess-story", dir).href,
    "module unrelated; story empty {}"
  );
  const builder = createCompiler();
  const initial = value(await builder.update(sources));
  assert.deepEqual(initial.work, { parsed: 3, replayed: 2, emitted: 3 });
  const immutable: BuildSnapshot = initial.snapshot;
  assert.ok(Object.isFrozen(immutable));
  const before = JSON.stringify(immutable);
  const changed = new Map(sources);
  changed.set(
    story,
    sources.get(story)!.replace("The queen opens", "This queen opens")
  );
  const prose = value(await builder.update(changed));
  assert.deepEqual(prose.work, { parsed: 1, replayed: 0, emitted: 1 });
  const unrelated = new URL("unrelated.chess-story", dir).href;
  assert.equal(
    prose.snapshot.output.find((d) => d.uri === unrelated),
    initial.snapshot.output.find((d) => d.uri === unrelated)
  );
  for (let ply = 0; ply < 34; ply++)
    value(selectPosition(initial.snapshot, opera, ply));
  assert.equal(selectPosition(initial.snapshot, opera, 999).ok, false);
  assert.equal(Reflect.set(initial.snapshot, "revision", 999), false);
  assert.equal(JSON.stringify(initial.snapshot), before);
  const unchanged = value(await builder.update(changed));
  assert.equal(unchanged.snapshot, prose.snapshot);
  assert.deepEqual(unchanged.work, { parsed: 0, replayed: 0, emitted: 0 });
  changed.set(
    opera,
    sources
      .get(opera)!
      .replace('[Event "Opera Game"]', '[Event "Changed source"]')
  );
  const asset = value(await builder.update(changed));
  assert.equal(asset.work.parsed, 0);
  assert.equal(asset.work.replayed, 1);
  assert.equal(asset.work.emitted, 2);
  assert.equal(JSON.stringify(initial.snapshot), before);
  changed.delete(opera);
  const missing = value(await builder.update(changed));
  assert.ok(
    missing.snapshot.output.some((d) =>
      d.diagnostics.some((i) => i.code === "source/missing-game")
    )
  );
  changed.set(opera, sources.get(opera)!);
  const restored = value(await builder.update(changed));
  assert.equal(restored.work.replayed, 0); // content-addressed history survives deletion/re-addition
  assert.deepEqual(
    restored.snapshot.output,
    value(await compile(changed)).output
  );
});
void test("600: incremental results agree with clean builds over generated edit histories", async () => {
  const base = await fixtures();
  await fc.assert(
    fc.asyncProperty(
      fc.array(
        fc.constantFrom(
          "prose",
          "pgn",
          "missing",
          "restore",
          "invalid",
          "missing-module",
          "export"
        ),
        { maxLength: 6 }
      ),
      async (edits) => {
        const sources = new Map(base);
        const builder = createCompiler();
        value(await builder.update(sources));
        for (const edit of edits) {
          if (edit === "prose")
            sources.set(
              story,
              base.get(story)!.replace("The queen opens", "A queen opens")
            );
          if (edit === "pgn")
            sources.set(
              opera,
              base.get(opera)!.replace("Opera Game", "Opera source revision")
            );
          if (edit === "missing") sources.delete(opera);
          if (edit === "missing-module")
            sources.delete(new URL("library.chess-story", dir).href);
          if (edit === "export") {
            const uri = new URL("library.chess-story", dir).href;
            sources.set(
              uri,
              base.get(uri)!.replace("export game opera", "game opera")
            );
          }
          if (edit === "restore")
            for (const [uri, text] of base) sources.set(uri, text);
          if (edit === "invalid") sources.set(story, base.get(story)! + "\n @");
          const incremental = value(await builder.update(sources)).snapshot;
          const clean = value(await compile(sources));
          assert.deepEqual(incremental.output, clean.output);
          assert.deepEqual(incremental.games, clean.games);
        }
      }
    ),
    { seed, numRuns: 20 }
  );
});
void test("400: malformed PGN fuzzing is represented by history results", async () => {
  const builder = createCompiler();
  await fc.assert(
    fc.asyncProperty(fc.string({ maxLength: 512 }), async (source) => {
      const snapshot = value(
        await builder.update(new Map([[opera, source]]))
      ).snapshot;
      assert.equal(typeof snapshot.games[0].result.ok, "boolean");
    }),
    { seed, numRuns: 100 }
  );
});

void test("module interfaces: production consumers cannot deep-import other phases", async () => {
  const root = fileURLToPath(new URL("./", import.meta.url));
  async function files(directory: string): Promise<string[]> {
    return (
      await Promise.all(
        (await readdir(directory, { withFileTypes: true }))
          .filter((e) => e.name !== "generated")
          .map((e) => {
            const path = resolve(directory, e.name);
            return e.isDirectory()
              ? files(path)
              : Promise.resolve(path.endsWith(".ts") ? [path] : []);
          })
      )
    ).flat();
  }
  for (const file of await files(root)) {
    const owner = relative(root, file).split(sep).join("/");
    const source = await readFile(file, "utf8");
    // Guard this experiment's static imports/re-exports. Dynamic imports need a stronger scanner.
    assert.ok(
      !/\bimport\s*\(/.test(source),
      `Dynamic import requires extending the architecture guard: ${owner}`
    );
    const imports = [
      ...source.matchAll(
        /\b(?:import|export)\s+(?:type\s+)?(?:[^"';]*?\s+from\s*)?["']([^"']+)["']/g
      ),
    ].map((match) => match[1]);
    if (owner.startsWith("contracts/"))
      assert.ok(
        imports.every(
          (i) =>
            !i.includes("compiler") &&
            !i.includes("langium") &&
            !i.includes("chessops") &&
            !i.startsWith("node:")
        )
      );
    for (const specifier of imports.filter((i) => i.startsWith("."))) {
      const target = relative(root, resolve(dirname(file), specifier))
        .split(sep)
        .join("/");
      const phase = /^compiler\/(\d{3}-[^/]+)\//.exec(target)?.[1];
      const samePhase = phase && owner.startsWith(`compiler/${phase}/`);
      if (phase && !samePhase)
        assert.ok(
          target.endsWith(`/${phase}/index.js`),
          `${owner} bypasses ${phase}'s interface: ${specifier}`
        );
      if (owner.startsWith("adapters/") && target.startsWith("compiler/"))
        assert.ok(
          ["compiler/index.js", "compiler/lsp.js"].includes(target),
          `${owner} bypasses compiler interface`
        );
    }
  }
});

void test("phase diagnostics: local, linking and chess failures are distinct values", async () => {
  const sources = await fixtures();
  const library = new URL("library.chess-story", dir).href;
  const changed = new Map(sources);
  changed.set(
    library,
    sources.get(library)! + '\nimport "./story.chess-story";'
  );
  // Imports precede declarations in this experimental grammar: put it in the valid position.
  changed.set(
    library,
    sources
      .get(library)!
      .replace(
        "module library;",
        'module library; import "./story.chess-story";'
      )
  );
  const cyclic = value(await compile(changed));
  assert.ok(
    cyclic.output.some((d) =>
      d.diagnostics.some((i) => i.code === "link/import-cycle")
    )
  );
  changed.set(library, sources.get(library)!);
  changed.set(
    story,
    sources.get(story)!.replace("game opera", "game privateGame")
  );
  assert.ok(
    value(await compile(changed)).output.some((d) =>
      d.diagnostics.some((i) => i.code === "link/unresolved-game")
    )
  );
  changed.set(
    story,
    sources.get(story)!.replace("after 30", "after 9007199254740992")
  );
  assert.ok(
    value(await compile(changed)).output.some((d) =>
      d.diagnostics.some(
        (i) =>
          i.code === "document/invalid-shape" &&
          i.phase === "200-semantic-analysis"
      )
    )
  );
  changed.set(story, sources.get(story)!.replace("Qb8+", "Qh9"));
  assert.ok(
    value(await compile(changed)).output.some((d) =>
      d.diagnostics.some(
        (i) =>
          i.code === "chess/illegal-answer" && i.phase === "400-chess-analysis"
      )
    )
  );
  changed.set(
    story,
    sources.get(story)!.replace("board retiFinish", "board operaFinish")
  );
  assert.ok(
    value(await compile(changed)).output.some((d) =>
      d.diagnostics.some(
        (i) =>
          i.code === "semantic/duplicate-occurrence" &&
          i.phase === "200-semantic-analysis"
      )
    )
  );
});
void test("600: busy writes return errors; a failed host leaves prior snapshots readable", async () => {
  const sources = await fixtures();
  const builder = createCompiler();
  const first = builder.update(sources);
  const concurrent = await builder.update(sources);
  assert.equal(concurrent.ok, false);
  if (!concurrent.ok) assert.equal(concurrent.error.code, "build/busy");
  const before = value(await first).snapshot;
  class BrokenSourceMap extends Map<string, string> {
    override [Symbol.iterator](): MapIterator<[string, string]> {
      throw new Error("injected source-host failure");
    }
  }
  const failed = await builder.update(new BrokenSourceMap());
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.equal(failed.error.code, "build/failure");
  const retry = await builder.update(sources);
  assert.equal(retry.ok, false);
  if (!retry.ok) assert.equal(retry.error.code, "build/recreate-required");
  value(selectPosition(before, opera, 30));
});

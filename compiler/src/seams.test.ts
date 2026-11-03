import { test } from "bun:test";

import { $ } from "bun";
import * as fc from "fast-check";
import { URI } from "langium";

import { loadDirectory } from "./adapters/files.js";
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
import { parseStructured } from "./contracts/index.js";
import type { Result } from "./contracts/index.js";
import { assert } from "./runtime/assert.js";
import { createBunFileSystem } from "./runtime/filesystem.js";
import { readSourceText } from "./runtime/source-text.js";

const required = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Required fixture value is unavailable.");
  }
  return value;
};

const value = <T>(result: Result<T>): T => {
  if (!result.ok) {
    assert.fail(JSON.stringify(result.error));
  }
  return result.value;
};
const seed = Number(process.env.FC_SEED ?? 20_261_102);
const options = { numRuns: 300, seed };
const identifier = fc.nat().map((n) => `id_${n}`);
const text = fc.oneof(
  fc.string(),
  fc.constantFrom('a"b', "\\n", "\n", "\r\n", "\u0000", "\uD800", "♞ é")
);
const note = fc.oneof(
  fc.record({ text, type: fc.constant("text") }),
  fc.record({ answer: text, text, type: fc.constant("prompt") }),
  fc.record({
    color: identifier,
    from: text,
    to: text,
    type: fc.constant("arrow"),
  })
);
const authored = fc.record({
  formatVersion: fc.constant(0),
  games: fc.array(
    fc.record({ exported: fc.boolean(), name: identifier, source: text }),
    {
      maxLength: 3,
    }
  ),
  imports: fc.array(text, { maxLength: 3 }),
  name: identifier,
  stories: fc.array(
    fc.record({
      name: identifier,
      scenes: fc.array(
        fc.record({
          game: identifier,
          name: identifier,
          notes: fc.array(note, { maxLength: 4 }),
          ply: fc.integer({ max: Number.MAX_SAFE_INTEGER, min: 0 }),
        }),
        { maxLength: 3 }
      ),
    }),
    { maxLength: 2 }
  ),
});
test("200 ↔ 500: structured/flat codec preserves every generated authored value", () => {
  fc.assert(
    fc.property(authored, (document) => {
      const checked = value(parseStructured(document));
      assert.deepEqual(value(decode(value(printStructured(checked)))), checked);
    }),
    options
  );
});
test("100 ↔ 500: source envelopes preserve comments, whitespace, Unicode and line endings", () => {
  fc.assert(
    fc.property(
      authored,
      fc.constantFrom("\n", "\r\n"),
      fc.nat(20),
      (document, newline, spaces) => {
        const source = `// retained source${newline}${" ".repeat(
          spaces
        )}${value(printStructured(document)).replaceAll("\n", newline)}`;
        const data = value(decode(source));
        assert.equal(
          // oxlint-disable-next-line unicorn/prefer-structured-clone -- This tests a JSON transport roundtrip, not an in-memory clone.
          value(restore(JSON.parse(JSON.stringify(envelope(data, source))))),
          source
        );
        const stale = envelope(structuredClone(data), source);
        stale.data = { ...stale.data, name: `${stale.data.name}_changed` };
        assert.equal(restore(stale).ok, false);
      }
    ),
    options
  );
});
test("100 and document seams: bounded malformed input fuzzing returns values, not exceptions", () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 2048 }), (source) => {
      assert.ok([true, false].includes(decode(source).ok));
      assert.ok([true, false].includes(restore(source).ok));
    }),
    { ...options, numRuns: 500 }
  );
  fc.assert(
    fc.property(fc.jsonValue(), (data) => {
      assert.ok([true, false].includes(parseStructured(data).ok));
      assert.ok([true, false].includes(printStructured(data).ok));
    }),
    options
  );
});
const dir = new URL("../examples/", import.meta.url);
const story = new URL("story.chess-story", dir).href;
const opera = new URL("opera.pgn", dir).href;
const fixtures = async () =>
  new Map(
    await Promise.all(
      [
        ...new Bun.Glob("*").scanSync({
          cwd: Bun.fileURLToPath(dir),
          dot: true,
          onlyFiles: true,
        }),
      ].map(async (name) => {
        const uri = new URL(name, dir);
        return [uri.href, await readSourceText(uri)] as const;
      })
    )
  );
test("300/400/500/600: reuse, dependency invalidation, immutable history and pure views", async () => {
  const sources = await fixtures();
  sources.set(
    new URL("unrelated.chess-story", dir).href,
    "module unrelated; story empty {}"
  );
  const builder = createCompiler();
  const initial = value(await builder.update(sources));
  assert.deepEqual(initial.work, { emitted: 3, parsed: 3, replayed: 2 });
  const immutable: BuildSnapshot = initial.snapshot;
  assert.ok(Object.isFrozen(immutable));
  const before = JSON.stringify(immutable);
  const changed = new Map(sources);
  changed.set(
    story,
    required(sources.get(story)).replace("The queen opens", "This queen opens")
  );
  const prose = value(await builder.update(changed));
  assert.deepEqual(prose.work, { emitted: 1, parsed: 1, replayed: 0 });
  const unrelated = new URL("unrelated.chess-story", dir).href;
  assert.equal(
    prose.snapshot.output.find((d) => d.uri === unrelated),
    initial.snapshot.output.find((d) => d.uri === unrelated)
  );
  for (let ply = 0; ply < 34; ply += 1) {
    value(selectPosition(initial.snapshot, opera, ply));
  }
  assert.equal(selectPosition(initial.snapshot, opera, 999).ok, false);
  assert.equal(Reflect.set(initial.snapshot, "revision", 999), false);
  assert.equal(JSON.stringify(initial.snapshot), before);
  const unchanged = value(await builder.update(changed));
  assert.equal(unchanged.snapshot, prose.snapshot);
  assert.deepEqual(unchanged.work, { emitted: 0, parsed: 0, replayed: 0 });
  changed.set(
    opera,
    required(sources.get(opera)).replace(
      '[Event "Opera Game"]',
      '[Event "Changed source"]'
    )
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
  changed.set(opera, required(sources.get(opera)));
  const restored = value(await builder.update(changed));
  // Content-addressed history survives deletion/re-addition.
  assert.equal(restored.work.replayed, 0);
  assert.deepEqual(
    restored.snapshot.output,
    value(await compile(changed)).output
  );
});
/* oxlint-disable no-await-in-loop -- Generated edit order is part of the property; concurrent writes are explicitly rejected. */
test("600: incremental results agree with clean builds over generated edit histories", async () => {
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
          if (edit === "prose") {
            sources.set(
              story,
              required(base.get(story)).replace(
                "The queen opens",
                "A queen opens"
              )
            );
          }
          if (edit === "pgn") {
            sources.set(
              opera,
              required(base.get(opera)).replace(
                "Opera Game",
                "Opera source revision"
              )
            );
          }
          if (edit === "missing") {
            sources.delete(opera);
          }
          if (edit === "missing-module") {
            sources.delete(new URL("library.chess-story", dir).href);
          }
          if (edit === "export") {
            const uri = new URL("library.chess-story", dir).href;
            sources.set(
              uri,
              required(base.get(uri)).replace("export game opera", "game opera")
            );
          }
          if (edit === "restore") {
            for (const [uri, sourceText] of base) {
              sources.set(uri, sourceText);
            }
          }
          if (edit === "invalid") {
            sources.set(story, `${required(base.get(story))}\n @`);
          }
          const incremental = value(await builder.update(sources)).snapshot;
          const clean = value(await compile(sources));
          assert.deepEqual(incremental.output, clean.output);
          assert.deepEqual(incremental.games, clean.games);
        }
      }
    ),
    { numRuns: 20, seed }
  );
});
/* oxlint-enable no-await-in-loop */
test("400: malformed PGN fuzzing is represented by history results", async () => {
  const builder = createCompiler();
  await fc.assert(
    fc.asyncProperty(fc.string({ maxLength: 512 }), async (source) => {
      const { snapshot } = value(
        await builder.update(new Map([[opera, source]]))
      );
      assert.ok([true, false].includes(snapshot.games[0].result.ok));
    }),
    { numRuns: 100, seed }
  );
});

test("module interfaces: production consumers cannot deep-import other phases", async () => {
  const root = new URL("./", import.meta.url);
  const files = [
    ...new Bun.Glob("**/*.ts").scanSync({
      cwd: Bun.fileURLToPath(root),
      dot: true,
      onlyFiles: true,
    }),
  ].filter((file) => !file.includes("/generated/"));
  for (const file of files) {
    const owner = file;
    // oxlint-disable-next-line no-await-in-loop -- Keep a boundary failure attributable to the source currently being inspected.
    const source = await readSourceText(new URL(file, root));
    // Guard this experiment's static imports/re-exports. Dynamic imports need a stronger scanner.
    assert.ok(
      !/\bimport\s*\(/u.test(source),
      `Dynamic import requires extending the architecture guard: ${owner}`
    );
    const imports = [
      ...source.matchAll(
        /\b(?:import|export)\s+(?:type\s+)?(?:[^"';]*?\s+from\s*)?["'](?<capture1>[^"']+)["']/gu
      ),
    ].map((match) => match[1]);
    if (owner.startsWith("contracts/")) {
      assert.ok(
        imports.every(
          (i) =>
            !i.includes("compiler") &&
            !i.includes("langium") &&
            !i.includes("chessops") &&
            !i.startsWith("node:")
        )
      );
    }
    for (const specifier of imports.filter((i) => i.startsWith("."))) {
      const target = new URL(specifier, new URL(file, root)).pathname.slice(
        root.pathname.length
      );
      const phase = /^compiler\/(?<capture1>\d{3}-[^/]+)\//u.exec(target)?.[1];
      const samePhase =
        phase !== undefined && owner.startsWith(`compiler/${phase}/`);
      if (phase !== undefined && !samePhase) {
        assert.ok(
          target.endsWith(`/${phase}/index.js`),
          `${owner} bypasses ${phase}'s interface: ${specifier}`
        );
      }
      if (owner.startsWith("adapters/") && target.startsWith("compiler/")) {
        assert.ok(
          ["compiler/index.js", "compiler/lsp.js"].includes(target),
          `${owner} bypasses compiler interface`
        );
      }
    }
  }
});

test("phase diagnostics: local, linking and chess failures are distinct values", async () => {
  const sources = await fixtures();
  const library = new URL("library.chess-story", dir).href;
  const changed = new Map(sources);
  changed.set(
    library,
    `${required(sources.get(library))}\nimport "./story.chess-story";`
  );
  // Imports precede declarations in this experimental grammar: put it in the valid position.
  changed.set(
    library,
    required(sources.get(library)).replace(
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
  changed.set(library, required(sources.get(library)));
  changed.set(
    story,
    required(sources.get(story)).replace("game opera", "game privateGame")
  );
  assert.ok(
    value(await compile(changed)).output.some((d) =>
      d.diagnostics.some((i) => i.code === "link/unresolved-game")
    )
  );
  changed.set(
    story,
    required(sources.get(story)).replace("after 30", "after 9007199254740992")
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
  changed.set(story, required(sources.get(story)).replace("Qb8+", "Qh9"));
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
    required(sources.get(story)).replace(
      "board retiFinish",
      "board operaFinish"
    )
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
test("600: busy writes return errors; a failed host leaves prior snapshots readable", async () => {
  const sources = await fixtures();
  const builder = createCompiler();
  const first = builder.update(sources);
  const concurrent = await builder.update(sources);
  assert.equal(concurrent.ok, false);
  if (!concurrent.ok) {
    assert.equal(concurrent.error.code, "build/busy");
  }
  const before = value(await first).snapshot;
  class BrokenSourceMap extends Map<string, string> {
    override [Symbol.iterator](): MapIterator<[string, string]> {
      throw new Error(`injected source-host failure (${this.size} entries)`);
    }
  }
  const failed = await builder.update(new BrokenSourceMap());
  assert.equal(failed.ok, false);
  if (!failed.ok) {
    assert.equal(failed.error.code, "build/failure");
  }
  const retry = await builder.update(sources);
  assert.equal(retry.ok, false);
  if (!retry.ok) {
    assert.equal(retry.error.code, "build/recreate-required");
  }
  value(selectPosition(before, opera, 30));
});

test("Bun acquisition preserves BOMs and dot-prefixed sources through exact restoration", async () => {
  const directory = `${Bun.env.TMPDIR ?? "/tmp"}/chess-source-${crypto.randomUUID()}`;
  const source = "\uFEFFmodule hidden; story empty {}\n";
  try {
    await Bun.write(`${directory}/.hidden.chess-story`, source);
    const acquired = value(await loadDirectory(directory));
    const uri = Bun.pathToFileURL(`${directory}/.hidden.chess-story`).href;
    assert.equal(acquired.get(uri), source);
    const data = value(decode(source));
    assert.equal(value(restore(envelope(data, source))), source);
    // Langium retains its own hidden-document discovery policy; acquire a visible
    // module as well to exercise compilation and exact emitted source preservation.
    const visible = Bun.pathToFileURL(`${directory}/visible.chess-story`).href;
    acquired.set(visible, source);
    const compiled = value(await compile(acquired));
    assert.equal(
      compiled.output.find((document) => document.uri === visible)?.sourceText,
      source
    );
    const filesystem = createBunFileSystem(new Map());
    const location = URI.parse(uri);
    assert.equal(await filesystem.readFile(location), source);
    assert.equal(filesystem.readFileSync(location), source);
    const root = URI.parse(Bun.pathToFileURL(`${directory}/`).href);
    assert.equal(await filesystem.exists(root), true);
    const entries = await filesystem.readDirectory(root);
    assert.ok(entries.some((node) => node.uri.toString() === uri));
  } finally {
    await $`rm -rf ${directory}`.quiet();
  }
});

test("200 → 300: duplicate story and board diagnostics select the repeated name", async () => {
  const duplicateCases = [
    {
      code: "semantic/duplicate-symbol",
      name: "repeated",
      source: "module identities; story repeated {} story repeated {}",
    },
    {
      code: "semantic/duplicate-occurrence",
      name: "same",
      source:
        'module identities; game g from "./g.pgn"; story lesson { board same game g after 0 {} board same game g after 0 {} }',
    },
  ];
  await Promise.all(
    duplicateCases.map(async (fixture) => {
      const snapshot = value(
        await compile(
          new Map([
            ["file:///duplicates/story.chess-story", fixture.source],
            ["file:///duplicates/g.pgn", "*"],
          ])
        )
      );
      const document = required(
        snapshot.output.find((item) => item.uri.endsWith("story.chess-story"))
      );
      const diagnostic = required(
        document.diagnostics.find((item) => item.code === fixture.code)
      );
      assert.equal(
        diagnostic.range.start.character,
        fixture.source.lastIndexOf(fixture.name)
      );
      assert.equal(
        diagnostic.range.end.character - diagnostic.range.start.character,
        fixture.name.length
      );
    })
  );
});

/* oxlint-disable unicorn/prefer-structured-clone -- These tests verify the JSON serialization boundary, including envelopes. */
import { expect, test } from "bun:test";

import * as fc from "fast-check";

import {
  compile,
  createCompiler,
  createPlaybackPlan,
  decode,
  envelope,
  restore,
  printStructured,
  parseStructured,
  editMarkdownBoard,
  editMarkdownMetadata,
} from "../compiler/index.js";
import type { Result } from "../contracts/core.js";
import { parseMarkdown, printMarkdown } from "./markdown.js";

const value = <T>(result: Result<T>): T => {
  if (!result.ok) {
    throw new Error(JSON.stringify(result.error));
  }
  return result.value;
};
const example = new URL("../../examples/", import.meta.url);
const uri = new URL("queen-offers.chess.md", example).href;
const source = await Bun.file(new URL(uri)).text();
const files = new Map(
  await Promise.all(
    ["queen-offers.chess.md", "opera.pgn", "reti.pgn"].map(
      async (name) =>
        [
          new URL(name, example).href,
          await Bun.file(new URL(name, example)).text(),
        ] as const
    )
  )
);
const lesson = (prose: string) =>
  `---\nid: lesson\ntitle: "A title" # keep this comment\ngames:\n  opera: ./opera.pgn\n---\n\n# A story\n@id stable-story\n\n## A scene\n@id stable-scene\n@board opera after 30\n\n${prose}\n`;

test("Markdown, JSON AST and exact source envelopes have separate roundtrip laws", () => {
  const data = value(decode(source));
  expect(data.formatVersion).toBe(1);
  expect(value(decode(value(printStructured(data))))).toEqual(data);
  expect(value(parseStructured(JSON.parse(JSON.stringify(data))))).toEqual(
    data
  );
  const exact = `\uFEFF${source.replaceAll("\n", "\r\n")}`;
  expect(
    value(
      restore(JSON.parse(JSON.stringify(envelope(value(decode(exact)), exact))))
    )
  ).toBe(exact);
  expect(
    restore({ ...envelope(data, source), data: { ...data, name: "modified" } })
      .ok
  ).toBe(false);
});

test("seeded supported Markdown roundtrips preserve rich nodes, escapes and Unicode", () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.constantFrom(
          "A **bold** and *quiet* move.",
          "♞ Réti [source](https://example.org).",
          "\\@board is ordinary prose.",
          "```text\n@unknown fenced\n```",
          "- A rook\n- A bishop",
          "> @unknown quoted",
          "    @unknown indented",
          "`@unknown inline`",
          "<!-- author comment -->"
        ),
        { maxLength: 5, minLength: 1 }
      ),
      (blocks) => {
        const original = lesson(blocks.join("\n\n"));
        const data = value(decode(original));
        expect(value(decode(value(printStructured(data))))).toEqual(data);
        expect(value(restore(envelope(data, original)))).toBe(original);
      }
    ),
    { numRuns: 200, seed: 20_261_104 }
  );
});

test("directives reject unknown or incomplete constructs and preserve literal code", () => {
  for (const text of [
    "@unknown nope",
    "@prompt Missing answer",
    "@answer Qb8+",
    "@board opera after 3",
    "@arrow a9 -> a1 green",
  ]) {
    expect(parseMarkdown(lesson(text)).ok).toBe(false);
  }
  for (const text of [
    "hello@example.org",
    "\\@unknown literal",
    "```\n@unknown\n```",
    "`line\n@unknown\ncode`",
    "*`line\n@unknown\ncode`*",
    "[**`line\n@board opera after 1\ncode`**](https://example.org)",
    "> @unknown",
  ]) {
    expect(parseMarkdown(lesson(text)).ok).toBe(true);
  }
  expect(
    parseMarkdown(
      source.replace("id: queen-offers", "id: queen-offers\nid: duplicate")
    ).ok
  ).toBe(false);
  expect(
    parseMarkdown(
      source.replace("id: queen-offers", "id: queen-offers\nunsupported: true")
    ).ok
  ).toBe(false);
});

test("targeted metadata and board edits preserve all unrelated source bytes", () => {
  const original = lesson("A **rook**.").replaceAll("\n", "\r\n");
  const edited = value(editMarkdownMetadata(original, ["title"], "New title"));
  expect(edited).toBe(original.replace('"A title"', '"New title"'));
  const moved = value(
    editMarkdownBoard(edited, "stable-story", "stable-scene", "opera", 28)
  );
  expect(moved).toBe(
    edited.replace("@board opera after 30", "@board opera after 28")
  );
  expect(editMarkdownMetadata(original, ["games"], "invalid").ok).toBe(false);
});

test("Markdown uses shared linking, chess checks, rich playback and incremental replay", async () => {
  const compiler = createCompiler();
  const first = value(await compiler.update(files));
  expect(first.snapshot.output.flatMap((output) => output.diagnostics)).toEqual(
    []
  );
  const plan = value(createPlaybackPlan(first.snapshot, uri, "mating-nets"));
  expect(plan.version).toBe(3);
  expect(plan.scenes[0].notes.some((note) => note.type === "markdown")).toBe(
    true
  );
  const next = new Map(files).set(
    uri,
    source.replace("The queen opens", "A queen opens")
  );
  expect(value(await compiler.update(next)).work.replayed).toBe(0);
  const broken = value(
    await compile(
      new Map(files).set(uri, source.replace("@answer Qb8+", "@answer Ke9"))
    )
  );
  const diagnostic = broken.output[0].diagnostics.find(
    (item) => item.code === "chess/illegal-answer"
  );
  expect(diagnostic).toBeDefined();
  expect(diagnostic?.range.start.line).toBe(
    source.split("\n").findIndex((line) => line.startsWith("@prompt"))
  );
});

test("unrepresentable or unknown structured Markdown is rejected explicitly", () => {
  const parsed = value(parseMarkdown(source)).data;
  expect(parseStructured({ ...parsed, unknown: true }).ok).toBe(false);
  const altered = structuredClone(parsed);
  altered.stories[0].scenes[0].notes.push({
    content: { children: [], type: "root" },
    type: "markdown",
  });
  expect(printMarkdown(altered).ok).toBe(false);
});

test("YAML folded and literal scalar edits retain their line boundary", () => {
  for (const style of ["|", ">", "|-", ">+"]) {
    for (const newline of ["\n", "\r\n"]) {
      const original = lesson("Prose.")
        .replace(
          'title: "A title" # keep this comment',
          `title: ${style}\n  A title\nauthors: [Someone]`
        )
        .replaceAll("\n", newline);
      const edited = value(
        editMarkdownMetadata(original, ["title"], "Replacement")
      );
      expect(value(decode(edited)).formatVersion).toBe(1);
      expect(edited).toContain(
        `title: "Replacement"${newline}authors: [Someone]`
      );
      expect(edited.slice(edited.indexOf("# A story"))).toBe(
        original.slice(original.indexOf("# A story"))
      );
    }
  }
});

test("mixed authoring formats share exported bindings and invalidate dependents", async () => {
  const base = "file:///mixed/";
  const legacy = `${base}legacy.chess-story`;
  const markdown = `${base}story.chess.md`;
  const pgn = files.get(new URL("opera.pgn", example).href) ?? "";
  const sources = new Map([
    [legacy, 'module legacy; export game opera from "./opera.pgn";'],
    [
      markdown,
      lesson("A rook.").replace(
        "games:\n  opera: ./opera.pgn",
        "imports: [./legacy.chess-story]"
      ),
    ],
    [`${base}opera.pgn`, pgn],
  ]);
  const compiler = createCompiler();
  const built = value(await compiler.update(sources));
  expect(built.snapshot.output.flatMap((output) => output.diagnostics)).toEqual(
    []
  );
  expect(
    value(createPlaybackPlan(built.snapshot, markdown, "stable-story")).scenes
  ).toHaveLength(1);
  const changed = new Map(sources).set(
    legacy,
    'module legacy; game opera from "./opera.pgn";'
  );
  const next = value(await compiler.update(changed));
  expect(
    next.snapshot.output
      .find((output) => output.uri === markdown)
      ?.diagnostics.some(
        (diagnostic) => diagnostic.code === "link/unresolved-game"
      )
  ).toBe(true);
  const libraryMd = `${base}library.chess.md`;
  const reverse = new Map([
    [
      libraryMd,
      "---\nid: library\ngames:\n  opera: ./opera.pgn\nexports: [opera]\n---\n",
    ],
    [
      legacy,
      'module legacy; import "./library.chess.md"; story lesson { board start game opera after 30 {} }',
    ],
    [`${base}opera.pgn`, pgn],
  ]);
  expect(
    value(await compile(reverse)).output.flatMap((output) => output.diagnostics)
  ).toEqual([]);
});

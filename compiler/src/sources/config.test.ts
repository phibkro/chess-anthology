/* oxlint-disable import/no-nodejs-modules -- Filesystem lifecycle APIs exist only in test setup and cleanup. */
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  loadSourceConfig,
  parseSourceConfig,
  editSourceConfig,
} from "./config.js";
import { createProjectCompiler } from "./index.js";
import { openResolver } from "./resolver.js";

const text = `{
  "$schema": "./schema.json",
  "version": 1,
  // Keep the local archive ahead of the network.
  "providers": [{ "id": "archive", "kind": "directory", "path": "./games", }],
}`;

test("JSONC has comments, editor metadata and runtime validation", () => {
  expect(parseSourceConfig(text)).toEqual({
    providers: [{ id: "archive", kind: "directory", path: "./games" }],
    version: 1,
  });
  expect(() => parseSourceConfig(text, false)).toThrow();
  expect(() =>
    parseSourceConfig('{"version":1,"version":2,"providers":[]}')
  ).toThrow("Duplicate property");
  expect(() => parseSourceConfig('{ "version": 1, "providers": [ }')).toThrow();
  expect(() =>
    parseSourceConfig(text.replace('"archive"', '"BAD ID"'))
  ).toThrow();
  expect(() =>
    parseSourceConfig(text.replace('"version": 1', '"version": 2'))
  ).toThrow();
  const edited = editSourceConfig(text, ["providers", 0, "path"], "./archive");
  expect(edited).toBe(text.replace('"./games"', '"./archive"'));
});

test("JSON and JSONC load deterministically; comments and schema metadata do not change pins", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "chess-config-"));
  const root = Bun.pathToFileURL(`${directory}/`);
  try {
    await Bun.write(new URL("chess.sources.jsonc", root), text);
    const firstResolver = await openResolver({ root });
    const first = firstResolver.describe().config;
    await Bun.write(
      new URL("chess.sources.jsonc", root),
      text
        .replace("./schema.json", "./other.json")
        .replace("Keep the local", "Prefer the local")
    );
    const secondResolver = await openResolver({ root });
    expect(secondResolver.describe().config).toBe(first);
    await Bun.write(
      new URL("chess.sources.json", root),
      '{"version":1,"providers":[]}'
    );
    expect(loadSourceConfig(root)).rejects.toThrow("source/ambiguous-config");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("Markdown projects discover remote games through JSONC and rebuild frozen offline", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "chess-markdown-project-")
  );
  const root = Bun.pathToFileURL(`${directory}/`);
  try {
    await Bun.write(
      new URL("chess.sources.jsonc", root),
      `{
      // A remote PGN source.
      "version": 1,
      "providers": [{ "id": "archive", "kind": "http", "url": "https://example.org/{id}.pgn" }]
    }`
    );
    await Bun.write(
      new URL("lesson.chess.md", root),
      "---\nid: remote\ngames:\n  opera: chessdb://archive/opera\n---\n\n# Lesson\n## Finish\n@board opera after 30\n\nA **queen** offer.\n\n@prompt Find the forcing move.\n@answer Qb8+\n"
    );
    const pgn = await Bun.file(
      new URL("../../examples/opera.pgn", import.meta.url)
    ).text();
    let fetches = 0;
    const fetch: typeof globalThis.fetch = Object.assign(
      async () => {
        await Promise.resolve();
        fetches += 1;
        return new Response(pgn);
      },
      { preconnect: globalThis.fetch.preconnect }
    );
    const first = await createProjectCompiler().update({
      fetch,
      root,
      writeManifest: true,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      throw new Error(first.error.message);
    }
    expect(
      first.value.snapshot.output.flatMap((output) => output.diagnostics)
    ).toEqual([]);
    const second = await createProjectCompiler().update({
      fetch,
      mode: "frozen",
      offline: true,
      root,
    });
    expect(second.ok).toBe(true);
    expect(fetches).toBe(1);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

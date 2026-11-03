import { afterEach, expect, test } from "bun:test";
// oxlint-disable-next-line import/no-nodejs-modules -- Temporary test fixtures need filesystem lifecycle operations.
import { mkdtemp, rm } from "node:fs/promises";

import * as v from "valibot";

import { createPlaybackPlan } from "../compiler/index.js";
import {
  createProjectCompiler,
  loadProjectSources,
  openResolver,
} from "./index.js";
import type { SourceConfig } from "./schema.js";
import { lockSchema } from "./schema.js";
import { blobId, createBlobStore } from "./storage.js";

const roots: URL[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async (root) => {
      await rm(root, { force: true, recursive: true });
    })
  );
});
const fixture = async () => {
  const root = Bun.pathToFileURL(`${await mkdtemp("/tmp/chess-sources-")}/`);
  roots.push(root);
  return root;
};
const configure = async (
  root: URL,
  providers: SourceConfig["providers"] = [
    { id: "db", kind: "http", url: "https://games.example/{id}" },
  ]
) => {
  await Bun.write(
    new URL("chess.sources.json", root),
    JSON.stringify({ providers, version: 1 })
  );
};
const story = (source: string) =>
  `module example; game opera from "${source}"; story lesson { board start game opera after 0 {} }`;
const pgn = '[Event "Example"]\n\n1. e4 e5 *\n';
const changed = '[Event "Corrected"]\n\n1. d4 d5 *\n';
const fakeFetch = (get: () => string | Response): typeof fetch =>
  Object.assign(
    async () => {
      await Promise.resolve();
      const response = get();
      return response instanceof Response ? response : new Response(response);
    },
    { preconnect: fetch.preconnect }
  );

test("remote resolution survives fresh compilers, supports playback, and updates explicitly", async () => {
  const root = await fixture();
  await configure(root);
  await Bun.write(
    new URL("story.chess-story", root),
    story("chessdb://db/opera")
  );
  let calls = 0;
  let body = pgn;
  const fetcher = fakeFetch(() => {
    calls += 1;
    return body;
  });
  const compiler = createProjectCompiler();
  const first = await compiler.update({
    fetch: fetcher,
    root,
    writeManifest: true,
  });
  expect(first.ok).toBe(true);
  if (!first.ok) {
    return;
  }
  expect(first.value.snapshot.output[0].diagnostics).toEqual([]);
  expect(first.value.work.replayed).toBe(1);
  expect(
    createPlaybackPlan(
      first.value.snapshot,
      new URL("story.chess-story", root).href,
      "lesson"
    ).ok
  ).toBe(true);
  body = changed;
  const cached = await createProjectCompiler().update({
    fetch: fetcher,
    mode: "frozen",
    offline: true,
    root,
  });
  expect(cached.ok).toBe(true);
  expect(calls).toBe(1);
  const noChange = await compiler.update({ fetch: fetcher, root });
  expect(noChange.ok && noChange.value.work).toEqual({
    emitted: 0,
    parsed: 0,
    replayed: 0,
  });
  const updated = await compiler.update({
    fetch: fetcher,
    mode: "update",
    root,
  });
  expect(updated.ok && updated.value.work.replayed).toBe(1);
  expect(updated.ok && updated.value.work.parsed).toBe(0);
  expect(updated.ok && updated.value.changes.length).toBe(1);
  expect(calls).toBe(2);
  const staleEdition = await compiler.update({
    mode: "frozen",
    offline: true,
    root,
  });
  expect(!staleEdition.ok && staleEdition.error.code).toBe(
    "source/edition-changed"
  );
});

test("missing locked blobs require matching recovery, never silently accept changed records", async () => {
  const root = await fixture();
  await configure(root);
  await Bun.write(
    new URL("story.chess-story", root),
    story("chessdb://db/opera")
  );
  const initial = await createProjectCompiler().update({
    fetch: fakeFetch(() => pgn),
    root,
  });
  expect(initial.ok).toBe(true);
  const lock = v.parse(
    lockSchema,
    await Bun.file(new URL("chess.sources.lock.json", root)).json()
  );
  const id: string = lock.imports["chessdb://db/opera"].blob;
  await rm(new URL(`.chess-cache/blobs/sha256/${id.slice(7)}`, root));
  const bad = await loadProjectSources({
    fetch: fakeFetch(() => changed),
    root,
  });
  expect(!bad.ok && bad.error.code).toBe("source/locked-content-changed");
  const recovered = await loadProjectSources({
    fetch: fakeFetch(() => pgn),
    root,
  });
  expect(recovered.ok).toBe(true);
});

test("local files and overlays stay live; explicit paths never fall back", async () => {
  const root = await fixture();
  await configure(root);
  await Bun.write(new URL("opera.pgn", root), pgn);
  let calls = 0;
  const fetcher = fakeFetch(() => {
    calls += 1;
    return changed;
  });
  const resolver = await openResolver({ fetch: fetcher, root });
  const uri = new URL("opera.pgn", root).href;
  expect(new TextDecoder().decode(await resolver.read(uri, "opera.pgn"))).toBe(
    pgn
  );
  await Bun.write(new URL(uri), changed);
  expect(new TextDecoder().decode(await resolver.read(uri, "opera.pgn"))).toBe(
    changed
  );
  const overlay = await openResolver({ overlays: new Map([[uri, pgn]]), root });
  expect(new TextDecoder().decode(await overlay.read(uri, "./opera.pgn"))).toBe(
    pgn
  );
  await rm(new URL(uri));
  expect(await resolver.read(uri, "./opera.pgn").catch(String)).toContain(
    "source/missing"
  );
  expect(calls).toBe(0);
  expect(new TextDecoder().decode(await resolver.read(uri, "opera.pgn"))).toBe(
    changed
  );
  expect(calls).toBe(1);
});

test("local provider directories precede remote providers and qualified references stay scoped", async () => {
  const root = await fixture();
  await configure(root, [
    { id: "db", kind: "http", url: "https://games.example/{id}" },
    { id: "archive", kind: "directory", path: "./archive/" },
  ]);
  await Bun.write(new URL("archive/opera.pgn", root), pgn);
  const resolver = await openResolver({
    fetch: fakeFetch(() => changed),
    root,
  });
  const local = await resolver.read(
    new URL("opera.pgn", root).href,
    "opera.pgn"
  );
  expect(new TextDecoder().decode(local)).toBe(pgn);
  const remote = await resolver.read("chessdb://db/opera.pgn");
  expect(new TextDecoder().decode(remote)).toBe(changed);
});

test("selection locks a derived game while retaining the original multi-game export", async () => {
  const root = await fixture();
  await configure(root);
  await Bun.write(
    new URL("story.chess-story", root),
    story("chessdb://db/export#game=2")
  );
  let body = `${pgn}\n${changed}`;
  const compiler = createProjectCompiler();
  const first = await compiler.update({ fetch: fakeFetch(() => body), root });
  expect(first.ok && first.value.snapshot.output[0].diagnostics).toEqual([]);
  const lock = v.parse(
    lockSchema,
    await Bun.file(new URL("chess.sources.lock.json", root)).json()
  );
  const record = lock.imports["chessdb://db/export#game=2"];
  const blobs = createBlobStore(new URL(".chess-cache/blobs/", root));
  expect(new TextDecoder().decode(await blobs.get(record.original))).toBe(body);
  expect(record.blob).not.toBe(record.original);
  body = `${pgn.replace("Example", "Unrelated correction")}\n${changed}`;
  const updated = await compiler.update({
    fetch: fakeFetch(() => body),
    mode: "update",
    root,
  });
  expect(updated.ok && updated.value.work).toEqual({
    emitted: 0,
    parsed: 0,
    replayed: 0,
  });
});

test("publication verifies local bytes, blob integrity, and configuration identity", async () => {
  const root = await fixture();
  await Bun.write(new URL("story.chess-story", root), story("./opera.pgn"));
  await Bun.write(new URL("opera.pgn", root), pgn);
  const first = await createProjectCompiler().update({
    root,
    writeManifest: true,
  });
  expect(first.ok).toBe(true);
  const bytes = new TextEncoder().encode(pgn);
  const id = blobId(bytes);
  const store = createBlobStore(new URL(".chess-cache/blobs/", root));
  expect(await store.get(id)).toEqual(bytes);
  await Bun.write(
    new URL(`.chess-cache/blobs/sha256/${id.slice(7)}`, root),
    "corrupted"
  );
  expect(await store.get(id).catch(String)).toContain("source/corrupt-blob");
  await Bun.write(new URL("opera.pgn", root), changed);
  const frozen = await loadProjectSources({ mode: "frozen", root });
  expect(!frozen.ok && frozen.error.code).toBe("source/edition-changed");
  await configure(root);
  const reconfigured = await loadProjectSources({ root });
  expect(!reconfigured.ok && reconfigured.error.code).toBe(
    "source/config-changed"
  );
});

test("catalog reuse preserves provider precedence and missing locks fail frozen resolution", async () => {
  const root = await fixture();
  await configure(root);
  const uri = new URL("opera.pgn", root).href;
  let calls = 0;
  const fetcher = fakeFetch(() => {
    calls += 1;
    return pgn;
  });
  const first = await openResolver({ fetch: fetcher, root });
  await first.read(uri, "opera.pgn");
  await first.finish();
  await rm(new URL("chess.sources.lock.json", root));
  const frozen = await openResolver({ mode: "frozen", root });
  expect(await frozen.read(uri, "opera.pgn").catch(String)).toContain(
    "source/unlocked"
  );
  const catalog = await openResolver({ fetch: fetcher, offline: true, root });
  expect(new TextDecoder().decode(await catalog.read(uri, "opera.pgn"))).toBe(
    pgn
  );
  expect(calls).toBe(1);
  await Bun.write(new URL(uri), changed);
  expect(new TextDecoder().decode(await catalog.read(uri, "opera.pgn"))).toBe(
    changed
  );
});

test("one project update owns acquisition until completion", async () => {
  const root = await fixture();
  await configure(root);
  await Bun.write(
    new URL("story.chess-story", root),
    story("chessdb://db/opera")
  );
  const gate = Promise.withResolvers<undefined>();
  const started = Promise.withResolvers<undefined>();
  const fetcher: typeof fetch = Object.assign(
    async () => {
      started.resolve();
      await gate.promise;
      return new Response(pgn);
    },
    { preconnect: fetch.preconnect }
  );
  const compiler = createProjectCompiler();
  const pending = compiler.update({ fetch: fetcher, root });
  await started.promise;
  const overlap = await compiler.update({ root });
  expect(!overlap.ok && overlap.error.code).toBe("build/busy");
  gate.resolve();
  const completed = await pending;
  expect(completed.ok).toBe(true);
});

test("actual HTTP provider and CLI share persistent locks across processes", async () => {
  const root = await fixture();
  let calls = 0;
  const server = Bun.serve({
    fetch: () => {
      calls += 1;
      return new Response(pgn);
    },
    hostname: "127.0.0.1",
    port: 0,
  });
  try {
    await configure(root, [
      { id: "db", kind: "http", url: `${server.url.href}{id}` },
    ]);
    await Bun.write(
      new URL("story.chess-story", root),
      story("chessdb://db/opera")
    );
    const cli = new URL("../adapters/cli.ts", import.meta.url);
    const run = async (flags: string[]) => {
      const child = Bun.spawn(
        [
          process.execPath,
          Bun.fileURLToPath(cli),
          Bun.fileURLToPath(root),
          ...flags,
        ],
        { stderr: "pipe", stdout: "pipe" }
      );
      const [stdout, stderr, exit] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { exit, stderr, stdout };
    };
    const initial = await run(["--write-manifest"]);
    expect(initial.exit).toBe(0);
    expect(initial.stderr).toContain("Source chessdb://db/opera");
    const cached = await run(["--frozen", "--offline"]);
    expect(cached.exit).toBe(0);
    expect(cached.stdout).toBe(initial.stdout);
    expect(calls).toBe(1);
  } finally {
    await server.stop(true);
  }
});

test("explicit imports cannot reuse a bare-name provider result at the same URI", async () => {
  const root = await fixture();
  await configure(root);
  await Bun.write(
    new URL("story.chess-story", root),
    'module example; game remote from "opera.pgn"; game explicit from "./opera.pgn";'
  );
  const loaded = await loadProjectSources({
    fetch: fakeFetch(() => pgn),
    root,
  });
  expect(!loaded.ok && loaded.error.code).toBe("source/missing");
});

test("nested local selection preserves original export provenance and hidden entry files", async () => {
  const root = await fixture();
  const original = new TextEncoder().encode(`${pgn}\n${changed}`);
  await Bun.write(new URL("archive/export.pgn", root), original);
  await Bun.write(new URL(".hidden.chess-story", root), "module hidden;");
  await Bun.write(
    new URL("story.chess-story", root),
    story("./archive/export.pgn#game=2")
  );
  const built = await createProjectCompiler().update({
    root,
    writeManifest: true,
  });
  expect(built.ok).toBe(true);
  if (!built.ok) {
    return;
  }
  expect(built.value.manifest.inputs[".hidden.chess-story"]).toBeDefined();
  expect(built.value.snapshot.output).toHaveLength(1);
  expect(built.value.snapshot.output[0].diagnostics).toEqual([]);
  const record =
    built.value.manifest.resolutions.imports["archive/export.pgn#game=2"];
  expect(record.original).toBe(blobId(original));
  const store = createBlobStore(new URL(".chess-cache/blobs/", root));
  expect(await store.get(record.original)).toEqual(original);
});

import { expect, test } from "bun:test";

import { createSourceCache } from "./source-cache.js";

test("a failed disk read cannot erase a newer unsaved buffer", async () => {
  const sources = new Map<string, string>();
  const overlays = new Map<string, string>();
  const disk = Promise.withResolvers<string>();
  const acquire = createSourceCache(
    sources,
    overlays,
    async () => await disk.promise
  );
  const pending = acquire("file:///game.pgn");
  overlays.set("file:///game.pgn", "unsaved");
  disk.reject(new Error("deleted on disk"));
  expect(await pending).toBe("unsaved");
  expect(sources.get("file:///game.pgn")).toBe("unsaved");
});

test("a superseded disk read cannot replace newer acquired content", async () => {
  const sources = new Map<string, string>();
  const first = Promise.withResolvers<string>();
  const second = Promise.withResolvers<string>();
  let calls = 0;
  const acquire = createSourceCache(sources, new Map(), async () => {
    calls += 1;
    return calls === 1 ? await first.promise : await second.promise;
  });
  const older = acquire("file:///game.pgn");
  const newer = acquire("file:///game.pgn");
  second.resolve("new");
  expect(await newer).toBe("new");
  first.resolve("old");
  expect(await older).toBe("new");
  expect(sources.get("file:///game.pgn")).toBe("new");
});

test("an earlier read waits for a newer acquisition still in flight", async () => {
  const sources = new Map<string, string>();
  const first = Promise.withResolvers<string>();
  const second = Promise.withResolvers<string>();
  let calls = 0;
  const acquire = createSourceCache(sources, new Map(), async () => {
    calls += 1;
    return await (calls === 1 ? first.promise : second.promise);
  });
  const older = acquire("file:///game.pgn");
  const newer = acquire("file:///game.pgn");
  first.resolve("old");
  await Promise.resolve();
  second.resolve("new");
  expect(await older).toBe("new");
  expect(await newer).toBe("new");
  expect(sources.get("file:///game.pgn")).toBe("new");
});

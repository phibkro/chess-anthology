import { describe, it, expect } from "vite-plus/test";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compile, createPlaybackPlan } from "chess-compiler-prototype";
import { parsePlaybackPlan } from "chess-compiler-prototype/playback";
import saved from "../content/generated/queen-offers.json";
import { createStoryStore } from "./store";
async function sources() {
  const dir = resolve("prototypes/chess-compiler/examples");
  return new Map(
    await Promise.all(
      (await readdir(dir)).map(
        async (name) =>
          [
            pathToFileURL(resolve(dir, name)).href,
            await readFile(resolve(dir, name), "utf8"),
          ] as const,
      ),
    ),
  );
}
function plan() {
  const result = parsePlaybackPlan(saved);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
describe("compiler package → playback plan → reader session", () => {
  it("consumes the actual package and reproduces the committed, portable story plan", async () => {
    const input = await sources();
    const result = await compile(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const built = createPlaybackPlan(
      result.value,
      pathToFileURL(resolve("prototypes/chess-compiler/examples/story.chess-story")).href,
      "matingNets",
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value).toEqual(saved);
    expect(JSON.stringify(built.value)).not.toContain("file:///");
    expect(built.value.scenes.map((s) => s.frames[s.after].san)).toEqual(["Nxd7", "Nxe4"]);
    expect(built.value.scenes[0].notes.some((n) => n.type === "arrow")).toBe(true);
  });
  it("keeps legal tries visible without advancing, then accepts the authored move", () => {
    const document = plan();
    const original = JSON.stringify(document);
    const store = createStoryStore(document);
    store.trigger.submit({ uci: "b3a3" });
    expect(store.getSnapshot().context.attempt?.san).toBe("Qa3");
    expect(store.getSnapshot().context.feedback).toBe("Try again.");
    store.trigger.next();
    expect(store.getSnapshot().context.ply).toBe(30);
    store.trigger.retry();
    expect(store.getSnapshot().context.attempt).toBeNull();
    store.trigger.submit({ uci: "b3b8" });
    expect(store.getSnapshot().context.ply).toBe(31);
    expect(store.getSnapshot().context.success).toBe(true);
    expect(JSON.stringify(document)).toBe(original);
  });
  it("selects each game history independently and resets transient state between examples", () => {
    const store = createStoryStore(plan());
    store.trigger.submit({ uci: "b3a3" });
    store.trigger.reveal();
    store.trigger.selectScene({ index: 1 });
    expect(store.getSnapshot().context).toMatchObject({
      scene: 1,
      ply: 16,
      attempt: null,
      revealed: false,
      feedback: "",
    });
    store.trigger.submit({ uci: "d3d8" });
    expect(store.getSnapshot().context.ply).toBe(17);
    store.trigger.selectScene({ index: 0 });
    expect(store.getSnapshot().context.ply).toBe(30);
    store.trigger.seek({ ply: 0 });
    expect(store.getSnapshot().context.ply).toBe(0);
    store.trigger.restart();
    expect(store.getSnapshot().context.ply).toBe(30);
  });
  it("reports a playback capability error for a legal answer outside the recorded continuation", async () => {
    const input = await sources();
    const uri = pathToFileURL(resolve("prototypes/chess-compiler/examples/story.chess-story")).href;
    input.set(uri, input.get(uri)!.replace("Qb8+", "Qa3"));
    const result = await compile(input);
    if (!result.ok) throw new Error(result.error.message);
    const built = createPlaybackPlan(result.value, uri, "matingNets");
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.error.code).toBe("plan/unsupported-prompt");
  });
});

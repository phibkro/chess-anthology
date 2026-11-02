import { describe, it, expect } from "bun:test";

import { compile, createPlaybackPlan } from "chess-compiler-prototype";
import { parsePlaybackPlan } from "chess-compiler-prototype/playback";

import saved from "../content/generated/queen-offers.json";
import { createStoryStore } from "./store";

const required = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Required fixture value is unavailable.");
  }
  return value;
};

const sources = async () => {
  const dir = new URL(
    "../../prototypes/chess-compiler/examples/",
    import.meta.url
  );
  return new Map(
    await Promise.all(
      [
        ...new Bun.Glob("*").scanSync({
          cwd: Bun.fileURLToPath(dir),
          dot: true,
          onlyFiles: true,
        }),
      ].map(async (name) => {
        const uri = new URL(name, dir);
        return [
          uri.href,
          new TextDecoder("utf-8", { ignoreBOM: true }).decode(
            await Bun.file(uri).arrayBuffer()
          ),
        ] as const;
      })
    )
  );
};

const plan = () => {
  const result = parsePlaybackPlan(saved);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
};
describe("compiler package → playback plan → reader session", () => {
  it("consumes the actual package and reproduces the committed, portable story plan", async () => {
    const input = await sources();
    const result = await compile(input);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const built = createPlaybackPlan(
      result.value,
      new URL(
        "../../prototypes/chess-compiler/examples/story.chess-story",
        import.meta.url
      ).href,
      "matingNets"
    );
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    expect(Bun.deepEquals(built.value, saved, true)).toBe(true);
    expect(JSON.stringify(built.value)).not.toContain("file:///");
    expect(built.value.scenes.map((s) => s.frames[s.after].san)).toEqual([
      "Nxd7",
      "Nxe4",
    ]);
    expect(built.value.scenes[0].notes.some((n) => n.type === "arrow")).toBe(
      true
    );
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
      attempt: null,
      feedback: "",
      ply: 16,
      revealed: false,
      scene: 1,
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
    const uri = new URL(
      "../../prototypes/chess-compiler/examples/story.chess-story",
      import.meta.url
    ).href;
    input.set(uri, required(input.get(uri)).replace("Qb8+", "Qa3"));
    const result = await compile(input);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    const built = createPlaybackPlan(result.value, uri, "matingNets");
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.error.code).toBe("plan/unsupported-prompt");
    }
  });
});

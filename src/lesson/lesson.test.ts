import { describe, expect, it } from "vite-plus/test";
import { makeUci } from "chessops/util";
import { parseSan } from "chessops/san";
import lessons from "../content/lessons.json";
import { compileLesson, exportPgn, importPgn, importFen, positionFromFen } from "./chess";
import { createLessonStore, checkpointAt } from "./store";

const compiled = lessons.map(compileLesson);
const carpenter = compiled.find((lesson) => lesson.content.id === "carpenter")!;
const opera = compiled.find((lesson) => lesson.content.id === "opera")!;

describe("legal source scores and their narrative anchors", () => {
  it("validates every authored lesson and checkpoint", () => {
    expect(compiled).toHaveLength(4);
    for (const lesson of compiled) expect(lesson.frames.length).toBeGreaterThan(1);
  });
  it("keeps checkmate distinct from a historical resignation", () => {
    expect(positionFromFen(opera.frames.at(-1)!.fen).isCheckmate()).toBe(true);
    const reti = compiled.find((lesson) => lesson.content.id === "reti-tartakower")!;
    expect(positionFromFen(reti.frames.at(-1)!.fen).isCheckmate()).toBe(false);
    expect(reti.frames).toHaveLength(20);
  });
  it("checks the intended mate against every legal defense", () => {
    const start = positionFromFen(carpenter.frames[0].fen);
    const move = parseSan(start, "Qh3")!;
    start.play(move);
    const defenses = [...start.allDests()].flatMap(([from, dests]) =>
      [...dests].map((to) => ({ from, to })),
    );
    expect(defenses.map(makeUci)).toEqual(["d4e4"]);
    for (const defense of defenses) {
      const position = start.clone();
      position.play(defense);
      const mate = parseSan(position, "Rc4#");
      expect(mate).toBeDefined();
      position.play(mate!);
      expect(position.isCheckmate()).toBe(true);
    }
  });
  it("rejects illegal moves in side variations", () => {
    expect(() => importPgn("1. e4 e5 (1... e4) *")).toThrow("Illegal move");
  });
  it("round-trips comments and branches through PGN", () => {
    const imported = importPgn("1. e4 {An original comment} e5 (1... c5 $1) 2. Nf3 *");
    const exported = exportPgn(imported);
    expect(exported).toContain("An original comment");
    expect(exported).toContain("c5");
    expect(exported).toContain("$1");
    expect(importPgn(exported).frames.map((frame) => frame.fen)).toEqual(
      imported.frames.map((frame) => frame.fen),
    );
  });
  it("preserves composition starting positions", () => {
    expect(importPgn(exportPgn(carpenter)).frames[0].fen).toBe(carpenter.frames[0].fen);
    expect(importFen(carpenter.frames[0].fen).frames).toHaveLength(1);
  });
  it("rejects unsupported variants and multiple games", () => {
    expect(() => importPgn('[Variant "Atomic"]\n\n1. e4 *')).toThrow("standard chess");
    expect(() => importPgn("1. e4 *\n\n1. d4 *")).toThrow("one game");
    expect(() => importPgn("x".repeat(131073))).toThrow("128 KiB");
  });
  it("rejects a checkpoint anchored to a different position", () => {
    const invalid = structuredClone(carpenter.content);
    invalid.narrative.checkpoints[0].path = ["a1a2"];
    expect(() => compileLesson(invalid)).toThrow("anchor");
  });
  it("rejects text without a game or a position", () => {
    expect(() => importPgn("not a chess score")).toThrow("No moves");
  });
  it("rejects executable source URLs in imported lesson metadata", () => {
    const unsafe = structuredClone(carpenter.content);
    unsafe.artifact.source.url = "javascript:alert(1)";
    expect(() => compileLesson(unsafe)).toThrow();
  });
  it("validates the lesson boundary with Valibot", () => {
    expect(() => compileLesson({ id: "broken" })).toThrow();
  });
});

describe("lesson events", () => {
  it("does not advance on illegal or off-line legal moves", () => {
    const store = createLessonStore(carpenter);
    store.trigger.submit({ uci: "f3f8" });
    expect(store.getSnapshot().context.cursor).toBe(0);
    store.trigger.submit({ uci: "f3g3" });
    expect(store.getSnapshot().context.cursor).toBe(0);
    expect(store.getSnapshot().context.feedback).toContain("legal move");
  });
  it("supports progressive hints, reveal and the intended move", () => {
    const store = createLessonStore(carpenter);
    store.trigger.hint();
    store.trigger.hint();
    store.trigger.hint();
    expect(store.getSnapshot().context.hints).toBe(2);
    store.trigger.reveal();
    expect(store.getSnapshot().context.revealed).toBe(true);
    store.trigger.submit({ uci: "f3h3" });
    expect(store.getSnapshot().context.cursor).toBe(1);
    expect(store.getSnapshot().context.hints).toBe(0);
    store.trigger.next();
    expect(checkpointAt(store.getSnapshot().context)).toBeDefined();
    store.trigger.submit({ uci: "c2c4" });
    expect(store.getSnapshot().context.cursor).toBe(3);
  });
  it("bounds navigation and resets prompt state on rewind", () => {
    const store = createLessonStore(carpenter);
    store.trigger.previous();
    expect(store.getSnapshot().context.cursor).toBe(0);
    store.trigger.hint();
    store.trigger.seek({ cursor: 999 });
    expect(store.getSnapshot().context.cursor).toBe(3);
    expect(store.getSnapshot().context.hints).toBe(0);
    store.trigger.reset();
    expect(store.getSnapshot().context.cursor).toBe(0);
  });
  it("allows skipping and replay without grading", () => {
    const store = createLessonStore(carpenter);
    store.trigger.togglePractice();
    store.trigger.submit({ uci: "f3h3" });
    expect(store.getSnapshot().context.cursor).toBe(0);
    store.trigger.next();
    expect(store.getSnapshot().context.cursor).toBe(1);
  });
  it("uses the same event model for a real game", () => {
    const store = createLessonStore(opera);
    store.trigger.seek({ cursor: 30 });
    expect(checkpointAt(store.getSnapshot().context)).toBeDefined();
    store.trigger.submit({ uci: "b3b8" });
    expect(store.getSnapshot().context.cursor).toBe(31);
    store.trigger.next();
    store.trigger.next();
    expect(positionFromFen(store.getSnapshot().context.lesson.frames[33].fen).isCheckmate()).toBe(
      true,
    );
  });
});

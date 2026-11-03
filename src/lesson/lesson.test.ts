import { describe, expect, it } from "bun:test";

import { parseSan } from "chessops/san";
import { makeUci, parseSquare } from "chessops/util";

import lessons from "../content/lessons.json";
import {
  compileLesson,
  eventsAt,
  exportPgn,
  importPgn,
  importFen,
  positionFromFen,
} from "./chess";
import { createLessonStore, checkpointAt } from "./store";

const required = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Required fixture value is unavailable.");
  }
  return value;
};

const compiled = lessons.map(compileLesson);
const carpenter = required(
  compiled.find((lesson) => lesson.content.id === "carpenter")
);
const opera = required(
  compiled.find((lesson) => lesson.content.id === "opera")
);

describe("legal source scores and their narrative anchors", () => {
  it("validates every authored lesson and checkpoint", () => {
    expect(compiled).toHaveLength(4);
    for (const lesson of compiled) {
      expect(lesson.frames.length).toBeGreaterThan(1);
    }
  });
  it("keeps checkmate distinct from a historical resignation", () => {
    expect(
      positionFromFen(required(opera.frames.at(-1)).fen).isCheckmate()
    ).toBe(true);
    const reti = required(
      compiled.find((lesson) => lesson.content.id === "reti-tartakower")
    );
    expect(
      positionFromFen(required(reti.frames.at(-1)).fen).isCheckmate()
    ).toBe(false);
    expect(reti.frames).toHaveLength(20);
  });
  it("checks the intended mate against every legal defense", () => {
    const start = positionFromFen(carpenter.frames[0].fen);
    const move = required(parseSan(start, "Qh3"));
    start.play(move);
    const defenses = [...start.allDests()].flatMap(([from, dests]) =>
      [...dests].map((to) => ({ from, to }))
    );
    expect(defenses.map(makeUci)).toEqual(["d4e4"]);
    for (const defense of defenses) {
      const position = start.clone();
      position.play(defense);
      const mate = parseSan(position, "Rc4#");
      expect(mate).toBeDefined();
      position.play(required(mate));
      expect(position.isCheckmate()).toBe(true);
    }
  });
  it("rejects illegal moves in side variations", () => {
    expect(() => importPgn("1. e4 e5 (1... e4) *")).toThrow("Illegal move");
  });
  it("round-trips comments and branches through PGN", () => {
    const imported = importPgn(
      "1. e4 {An original comment} e5 (1... c5 $1) 2. Nf3 *"
    );
    const exported = exportPgn(imported);
    expect(exported).toContain("An original comment");
    expect(exported).toContain("c5");
    expect(exported).toContain("$1");
    expect(importPgn(exported).frames.map((frame) => frame.fen)).toEqual(
      imported.frames.map((frame) => frame.fen)
    );
  });
  it("preserves composition starting positions", () => {
    expect(importPgn(exportPgn(carpenter)).frames[0].fen).toBe(
      carpenter.frames[0].fen
    );
    expect(importFen(carpenter.frames[0].fen).frames).toHaveLength(1);
  });
  it("rejects unsupported variants and multiple games", () => {
    expect(() => importPgn('[Variant "Atomic"]\n\n1. e4 *')).toThrow(
      "standard chess"
    );
    expect(() => importPgn("1. e4 *\n\n1. d4 *")).toThrow("one game");
    expect(() => importPgn("x".repeat(131_073))).toThrow("128 KiB");
  });
  it("rejects a checkpoint anchored to a different position", () => {
    const invalid = structuredClone(carpenter.content);
    invalid.narrative.events[0].after = ["a1a2"];
    expect(() => compileLesson(invalid)).toThrow("anchor");
  });
  it("rejects text without a game or a position", () => {
    expect(() => importPgn("not a chess score")).toThrow("No moves");
  });
  it("rejects executable source URLs in imported lesson metadata", () => {
    const unsafe = structuredClone(carpenter.content);
    unsafe.artifact.source.url = ["javascript", "alert(1)"].join(":");
    expect(() => compileLesson(unsafe)).toThrow();
  });
  it("validates the lesson boundary with Valibot", () => {
    expect(() => compileLesson({ id: "broken" })).toThrow();
  });
});

describe("lesson events", () => {
  it("keeps an off-line legal try on the board without changing the source score", () => {
    const store = createLessonStore(carpenter);
    const pgn = exportPgn(carpenter);
    store.trigger.submit({ uci: "f3g3" });
    const { context } = store.getSnapshot();
    expect(context.cursor).toBe(0);
    expect(context.attempt?.san).toBe("Qg3");
    expect(
      positionFromFen(required(context.attempt).fen).board.get(
        parseSquare("g3")
      )?.role
    ).toBe("queen");
    expect(context.feedback).toContain("right idea");
    expect(context.feedbackTone).toBe("encouraging");
    expect(exportPgn(context.lesson)).toBe(pgn);
  });
  it("uses a neutral retry when no authored interpretation exists", () => {
    const store = createLessonStore(carpenter);
    store.trigger.submit({ uci: "f3f8" });
    expect(store.getSnapshot().context.attempt?.san).toBe("Qf8");
    expect(store.getSnapshot().context.feedback).toBe("Try again.");
    expect(store.getSnapshot().context.feedbackTone).toBe("neutral");
  });
  it("does not invent a continuation for a try and waits for explicit retry", () => {
    const store = createLessonStore(carpenter);
    store.trigger.hint();
    store.trigger.submit({ uci: "f3g3" });
    const { attempt } = store.getSnapshot().context;
    store.trigger.next();
    store.trigger.submit({ uci: "d4e4" });
    expect(store.getSnapshot().context.attempt).toEqual(attempt);
    expect(store.getSnapshot().context.cursor).toBe(0);
    store.trigger.retry();
    expect(store.getSnapshot().context.attempt).toBeNull();
    expect(store.getSnapshot().context.hints).toBe(1);
    store.trigger.submit({ uci: "f3h3" });
    expect(store.getSnapshot().context.cursor).toBe(1);
  });
  it("reveal and undo restore the anchor without corrupting the timeline", () => {
    const store = createLessonStore(carpenter);
    store.trigger.submit({ uci: "f3g3" });
    store.trigger.reveal();
    expect(store.getSnapshot().context.attempt).toBeNull();
    expect(store.getSnapshot().context.revealed).toBe(true);
    store.trigger.submit({ uci: "f3g3" });
    store.trigger.previous();
    expect(store.getSnapshot().context.cursor).toBe(0);
    expect(store.getSnapshot().context.attempt).toBeNull();
  });
  it("handles illegal keyboard input constructively without applying it", () => {
    const store = createLessonStore(carpenter);
    store.trigger.submit({ uci: "f3c2" });
    expect(store.getSnapshot().context.attempt).toBeNull();
    expect(store.getSnapshot().context.feedback).toBe(
      "Choose a legal move, then try again."
    );
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
    expect(store.getSnapshot().context.cursor).toBe(1);
    expect(store.getSnapshot().context.feedback).toBe("");
    store.trigger.next();
    expect(store.getSnapshot().context.cursor).toBe(2);
  });
  it("accepts piece moves between checkpoints", () => {
    const store = createLessonStore(carpenter);
    store.trigger.next();
    store.trigger.submit({ uci: "d4e4" });
    expect(store.getSnapshot().context.cursor).toBe(2);
  });
  it("allows moving the pieces from a historical game opening", () => {
    const store = createLessonStore(opera);
    store.trigger.submit({ uci: "e2e4" });
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
    expect(
      positionFromFen(
        store.getSnapshot().context.lesson.frames[33].fen
      ).isCheckmate()
    ).toBe(true);
  });
});

describe("move-anchored lesson annotations", () => {
  it("attaches ordered text after the indexed move, before the following move", () => {
    expect(eventsAt(carpenter, 0).map(({ event }) => event.type)).toEqual([
      "prompt",
    ]);
    expect(eventsAt(carpenter, 1).map(({ event }) => event.type)).toEqual([
      "text",
    ]);
    const content = structuredClone(carpenter.content);
    content.narrative.events.push(
      { after: 1, id: "note-a", text: "First additional note", type: "text" },
      { after: 1, id: "note-b", text: "Second additional note", type: "text" }
    );
    expect(
      eventsAt(compileLesson(content), 1)
        .slice(-2)
        .map(({ event }) => event.id)
    ).toEqual(["note-a", "note-b"]);
  });
  it("resolves a legal-move path to the same position as a ply index", () => {
    const content = structuredClone(carpenter.content);
    content.narrative.events.push({
      after: ["f3h3"],
      id: "path-note",
      text: "After the key",
      type: "text",
    });
    expect(eventsAt(compileLesson(content), 1).at(-1)?.event.id).toBe(
      "path-note"
    );
  });
  it("round-trips annotations and authored feedback through lesson JSON", () => {
    const imported = compileLesson(
      // oxlint-disable-next-line unicorn/prefer-structured-clone -- This tests a JSON transport roundtrip, not an in-memory clone.
      JSON.parse(JSON.stringify(carpenter.content))
    );
    expect(imported.content).toEqual(carpenter.content);
    expect(imported.events).toEqual(carpenter.events);
  });
  it("migrates unversioned checkpoint lessons on import", () => {
    const legacy = {
      artifact: carpenter.content.artifact,
      id: carpenter.content.id,
      narrative: {
        checkpoints: carpenter.events
          .filter(({ event }) => event.type === "prompt")
          .map(({ event, cursor }) => {
            if (event.type !== "prompt") {
              throw new Error("Expected prompt");
            }
            const { prompt, hints, explanation, accepted, feedback } = event;
            return {
              accepted,
              explanation,
              feedback,
              hints,
              path: carpenter.frames[cursor].path,
              prompt,
            };
          }),
        introduction: carpenter.content.narrative.introduction,
        subtitle: carpenter.content.narrative.subtitle,
        title: carpenter.content.narrative.title,
      },
    };
    const imported = compileLesson(legacy);
    expect(imported.content.formatVersion).toBe(1);
    expect(
      imported.events.filter(({ event }) => event.type === "prompt")
    ).toHaveLength(2);
    expect("checkpoints" in imported.content.narrative).toBe(false);
  });
  it("rejects unknown fields instead of silently discarding authored data", () => {
    const original = JSON.stringify(carpenter.content);
    const inputs = [
      { ...carpenter.content, extra: "keep me" },
      {
        ...carpenter.content,
        artifact: { ...carpenter.content.artifact, arrows: [] },
      },
      {
        ...carpenter.content,
        narrative: { ...carpenter.content.narrative, style: {} },
      },
    ];
    for (const input of inputs) {
      expect(() => compileLesson(input)).toThrow();
    }
    const nested = {
      ...carpenter.content,
      artifact: {
        ...carpenter.content.artifact,
        source: { ...carpenter.content.artifact.source, extra: "provenance" },
      },
    };
    expect(() => compileLesson(nested)).toThrow();
    const malformedEvent = {
      ...carpenter.content,
      narrative: {
        ...carpenter.content.narrative,
        events: carpenter.content.narrative.events.map((annotation, index) =>
          index === 0 ? { ...annotation, extra: "annotation" } : annotation
        ),
      },
    };
    expect(() => compileLesson(malformedEvent)).toThrow();
    const malformedFeedback = {
      ...carpenter.content,
      narrative: {
        ...carpenter.content.narrative,
        events: carpenter.content.narrative.events.map((annotation) =>
          annotation.type === "prompt"
            ? {
                ...annotation,
                feedback: [
                  { extra: "idea", message: "Try again.", move: "f3g3" },
                ],
              }
            : annotation
        ),
      },
    };
    expect(() => compileLesson(malformedFeedback)).toThrow();
    expect(JSON.stringify(carpenter.content)).toBe(original);
  });
  it("rejects duplicate IDs, missing anchors, and unsupported format versions", () => {
    const content = structuredClone(carpenter.content);
    content.narrative.events.push({ ...content.narrative.events[0] });
    expect(() => compileLesson(content)).toThrow("Duplicate annotation ID");
    expect(() =>
      compileLesson({ ...carpenter.content, formatVersion: 99 })
    ).toThrow();
    const missing = structuredClone(carpenter.content);
    missing.narrative.events[0].after = 100;
    expect(() => compileLesson(missing)).toThrow("anchor");
  });
  it("only attaches interpretation to explicitly authored legal alternatives", () => {
    const invalid = structuredClone(carpenter.content);
    const event = invalid.narrative.events.find(
      (annotation) => annotation.type === "prompt"
    );
    if (!event || event.type !== "prompt") {
      throw new Error("Missing prompt fixture");
    }
    event.feedback = [{ message: "Try a different idea", move: "f3c2" }];
    expect(() => compileLesson(invalid)).toThrow("legal alternative");
  });
});

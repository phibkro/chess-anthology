import { test } from "bun:test";

import fixtures from "../evaluation/corpus/chess960.json" with { type: "json" };
import type { BuildSnapshot } from "./compiler/index.js";
import {
  compile,
  createPlaybackPlan,
  selectPosition,
} from "./compiler/index.js";
import type { Result } from "./contracts/index.js";
import { playbackFrames } from "./contracts/playback.js";
import { assert } from "./runtime/assert.js";

const value = <T>(result: Result<T>): T => {
  if (!result.ok) {
    assert.fail(JSON.stringify(result.error));
  }
  return result.value;
};
const gameResult = (snapshot: BuildSnapshot, uri: string) => {
  const game = snapshot.games.find((entry) => entry.uri === uri);
  assert.ok(game !== undefined, uri);
  return game.result;
};
const pgn = (fen: string, moves = "") =>
  `[Variant "Chess960"]\n[SetUp "1"]\n[FEN "${fen}"]\n\n${moves} *`;

// Independent enumeration of back-rank permutations, without chessops generation.
const permutations = (remaining: string, prefix = ""): string[] =>
  remaining.length === 0
    ? [prefix]
    : [...new Set(remaining)].flatMap((piece) =>
        permutations(remaining.replace(piece, ""), prefix + piece)
      );
const initialRanks = permutations("BBKNNQRR").filter(
  (rank) =>
    rank.indexOf("B") % 2 !== rank.lastIndexOf("B") % 2 &&
    rank.indexOf("R") < rank.indexOf("K") &&
    rank.indexOf("K") < rank.lastIndexOf("R")
);

test("400: explicit setup requires FEN; ordinary PGN retains its default start", async () => {
  const headers = [
    '[Variant "Chess960"]',
    '[Variant "CHESS 960"]',
    '[Variant "Fischerandom"]',
    '[Variant "FischerRandom"]',
    '[Variant "Fischer Random"]',
    '[SetUp "1"]',
  ];
  const sources = new Map(
    headers.map((header, i) => [
      `file:///fixtures/missing-${i}.pgn`,
      `${header}\n\n*`,
    ])
  );
  sources.set("file:///fixtures/ordinary.pgn", "1. e4 *");
  const snapshot = value(await compile(sources));
  for (const [uri] of sources) {
    const result = gameResult(snapshot, uri);
    if (uri.endsWith("ordinary.pgn")) {
      assert.equal(value(result).frames.length, 2);
    } else {
      assert.equal(result.ok, false, uri);
      if (!result.ok) {
        assert.equal(result.error.code, "chess/missing-setup", uri);
      }
    }
  }
});

test("400 → 600: all 960 complete initial arrays survive compilation and position selection", async () => {
  assert.equal(initialRanks.length, 960);
  assert.equal(new Set(initialRanks).size, 960);
  assert.ok(initialRanks.includes("RNBQKBNR"));
  const sources = new Map(
    initialRanks.map((rank) => [
      `file:///fixtures/${rank}.pgn`,
      pgn(
        `${rank.toLowerCase()}/pppppppp/8/8/8/8/PPPPPPPP/${rank} w KQkq - 0 1`
      ),
    ])
  );
  const snapshot = value(await compile(sources));
  assert.equal(snapshot.games.length, 960);
  for (const rank of initialRanks) {
    const uri = `file:///fixtures/${rank}.pgn`;
    const history = value(gameResult(snapshot, uri));
    assert.equal(history.frames.length, 1, rank);
    assert.equal(
      value(selectPosition(snapshot, uri, 0)).fen,
      `${rank.toLowerCase()}/pppppppp/8/8/8/8/PPPPPPPP/${rank} w KQkq - 0 1`,
      rank
    );
  }
});

test("400 → 500: castling fixtures produce literal positions and playable lesson answers", async () => {
  assert.equal(fixtures.version, 1);
  const sources = new Map<string, string>();
  for (const fixture of fixtures.accepted) {
    const base = `file:///fixtures/${fixture.id}`;
    sources.set(`${base}.pgn`, pgn(fixture.fen, fixture.moves));
    sources.set(
      `${base}.chess-story`,
      `module castling; game example from "./${fixture.id}.pgn";
       story lesson { board start game example after 0 {
         prompt "Castle." answer "${fixture.moves}";
       } }`
    );
  }
  const snapshot = value(await compile(sources));
  for (const fixture of fixtures.accepted) {
    const base = `file:///fixtures/${fixture.id}`;
    const selected = value(selectPosition(snapshot, `${base}.pgn`, 1));
    assert.equal(selected.fen, fixture.expectedFen, fixture.id);
    assert.equal(selected.uci, fixture.expectedUci, fixture.id);
    assert.equal(selected.san, fixture.moves, fixture.id);
    const plan = value(
      createPlaybackPlan(snapshot, `${base}.chess-story`, "lesson")
    );
    const [scene] = plan.scenes;
    assert.ok(scene !== undefined, fixture.id);
    assert.deepEqual(playbackFrames(plan, scene)[1], selected, fixture.id);
    assert.deepEqual(
      scene.notes,
      [
        {
          answer: fixture.moves,
          answerUci: fixture.expectedUci,
          text: "Castle.",
          type: "prompt",
        },
      ],
      fixture.id
    );
  }
});

test("400: attacks, occupied paths and lost rights reject recorded castling", async () => {
  const sources = new Map(
    fixtures.rejected.map((fixture) => [
      `file:///fixtures/${fixture.id}.pgn`,
      pgn(fixture.fen, fixture.moves),
    ])
  );
  const snapshot = value(await compile(sources));
  for (const fixture of fixtures.rejected) {
    const result = gameResult(snapshot, `file:///fixtures/${fixture.id}.pgn`);
    assert.equal(result.ok, false, fixture.id);
    if (!result.ok) {
      assert.equal(result.error.code, fixture.expectedCode, fixture.id);
    }
  }
});

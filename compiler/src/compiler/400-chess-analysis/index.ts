import { normalizeMove } from "chessops/chess";
import type { Position } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { parsePgn, startingPosition } from "chessops/pgn";
import { parseSan, makeSan } from "chessops/san";
import { makeUci, parseSquare } from "chessops/util";

import { ok, err } from "../../contracts/index.js";
import type {
  Result,
  GameHistory,
  SceneData,
  Issue,
  ReplayCachePolicy,
} from "../../contracts/index.js";
import { digest, freeze } from "../identity.js";

export type { GameHistory } from "../../contracts/index.js";

const replayRaw = (
  source: string
): Result<{
  frames: Position[];
  moves: { san: string | null; uci: string | null }[];
}> => {
  const games = parsePgn(source);
  if (games.length !== 1) {
    return err("chess", "chess/game-count", "Select exactly one PGN game.");
  }
  const [{ headers }] = games;
  const requiresSetup =
    headers.get("SetUp") === "1" ||
    [
      "chess960",
      "chess 960",
      "fischerandom",
      "fischerrandom",
      "fischer random",
    ].includes(headers.get("Variant")?.toLowerCase() ?? "");
  if (requiresSetup && (headers.get("FEN") ?? "") === "") {
    return err(
      "chess",
      "chess/missing-setup",
      "Provide a FEN header for Chess960 or a game marked SetUp 1."
    );
  }
  const start = startingPosition(headers);
  if (start.isErr) {
    return err("chess", "chess/invalid-position", "Invalid initial position.");
  }
  const position = start.value;
  if (position.rules !== "chess") {
    return err(
      "chess",
      "chess/unsupported-rules",
      "This prototype supports standard chess and Chess960 only."
    );
  }
  const frames = [position];
  const moves: { san: string | null; uci: string | null }[] = [
    { san: null, uci: null },
  ];
  // One traversal validates all branches and retains positions only along the mainline.
  const validateTree = (
    node: (typeof games)[number]["moves"],
    pos: Position,
    mainline: boolean
  ): string | undefined => {
    for (const [index, child] of node.children.entries()) {
      const move = parseSan(pos, child.data.san);
      if (!move || !pos.isLegal(move)) {
        return `Illegal recorded move: ${child.data.san}`;
      }
      const next = pos.clone();
      const recorded = mainline && index === 0;
      if (recorded) {
        moves.push({
          san: makeSan(pos, move),
          uci: makeUci(normalizeMove(pos, move)),
        });
      }
      next.play(move);
      if (recorded) {
        frames.push(next);
      }
      const issue = validateTree(child, next, recorded);
      if (issue !== undefined) {
        return issue;
      }
    }
    return undefined;
  };
  const issue = validateTree(games[0].moves, position, true);
  if (issue !== undefined) {
    return err("chess", "chess/illegal-move", issue);
  }
  return ok({ frames, moves });
};
const legalMoves = (position: Position) =>
  [...position.allDests()].flatMap(([from, dests]) =>
    [...dests].flatMap((to) => {
      const role = position.board.get(from)?.role;
      const promotions =
        role === "pawn" && (to < 8 || to >= 56)
          ? (["queen", "rook", "bishop", "knight"] as const)
          : [undefined];
      return promotions.map((promotion) => {
        const move = { from, promotion, to };
        return { san: makeSan(position, move), uci: makeUci(move) };
      });
    })
  );
/**
 * Check a linked occurrence and its annotations against recorded positions.
 * @param scene - The authored board occurrence.
 * @param frames - Recorded positions indexed by half-move.
 * @returns Check a linked occurrence and its annotations against recorded positions.
 */
export const analyzeScene = (scene: SceneData, frames: Position[]): Issue[] => {
  const position = scene.ply >= 0 ? frames.at(scene.ply) : undefined;
  if (!position) {
    return [
      {
        code: "chess/missing-position",
        message: `No recorded position after ply ${scene.ply}.`,
        path: ["ply"],
      },
    ];
  }
  return scene.notes.flatMap((note, i) => {
    if (note.type === "prompt") {
      const move = parseSan(position, note.answer);
      if (!move || !position.isLegal(move)) {
        return [
          {
            code: "chess/illegal-answer",
            message: `${note.answer} is not legal at this position.`,
            path: ["notes", i, "answer"],
          },
        ];
      }
    }
    if (note.type === "arrow") {
      if (
        parseSquare(note.from) === undefined ||
        parseSquare(note.to) === undefined
      ) {
        return [
          {
            code: "annotation/invalid-square",
            message: "Arrow endpoints must be chess squares.",
            path: ["notes", i, "from"],
          },
        ];
      }
      if (!["green", "red", "blue", "yellow"].includes(note.color)) {
        return [
          {
            code: "annotation/unsupported-color",
            message: `Unsupported brush ${note.color}.`,
            path: ["notes", i, "color"],
          },
        ];
      }
    }
    return [];
  });
};
/**
 * Project an engine position into FEN and legal move values.
 * @param position - The position used by this operation.
 * @returns Project an engine position into FEN and legal move values.
 */
export const positionData = (position: Position) => ({
  fen: makeFen(position.toSetup()),
  legalMoves: legalMoves(position),
});

/**
 * Create shared content-addressed replay analysis for one compiler instance.
 * @param limits - Budgets for inactive source revisions; active games remain retained.
 * @returns Create shared content-addressed replay analysis for one compiler instance.
 */
export const createChessAnalysis = (limits: ReplayCachePolicy = {}) => {
  const maxEntries = limits.maxInactiveEntries ?? 32;
  const maxPositions = limits.maxInactivePositions ?? 1024;
  const maxSourceBytes = limits.maxInactiveSourceBytes ?? 4 * 1024 * 1024;
  if (
    ![maxEntries, maxPositions, maxSourceBytes].every(
      (limit) => Number.isSafeInteger(limit) && limit >= 0
    )
  ) {
    throw new RangeError("Cache limits must be nonnegative safe integers.");
  }
  interface Entry {
    result: Result<{ frames: Position[]; history: GameHistory }>;
    positions: number;
    sourceBytes: number;
  }
  const entries = new Map<string, Entry>();
  const inactive = new Map<string, Entry>();
  const projections = new WeakMap<Position, ReturnType<typeof positionData>>();
  let active = new Set<string>();
  let inactivePositions = 0;
  let inactiveSourceBytes = 0;
  let replayCount = 0;
  const trim = () => {
    for (const [source, entry] of inactive) {
      if (
        inactive.size <= maxEntries &&
        inactivePositions <= maxPositions &&
        inactiveSourceBytes <= maxSourceBytes
      ) {
        break;
      }
      inactive.delete(source);
      entries.delete(source);
      inactivePositions -= entry.positions;
      inactiveSourceBytes -= entry.sourceBytes;
    }
  };
  const setActiveSources = (sources: Iterable<string>) => {
    active = new Set(sources);
    for (const [source, entry] of entries) {
      if (active.has(source)) {
        if (inactive.delete(source)) {
          inactivePositions -= entry.positions;
          inactiveSourceBytes -= entry.sourceBytes;
        }
      } else if (!inactive.has(source)) {
        inactive.set(source, entry);
        inactivePositions += entry.positions;
        inactiveSourceBytes += entry.sourceBytes;
      }
    }
    trim();
  };
  const replay = (source: string) => {
    // Exact immutable text identifies content within this fixed engine/rules instance.
    const hit = entries.get(source);
    if (hit !== undefined) {
      if (inactive.delete(source)) {
        inactive.set(source, hit);
      }
      return hit.result;
    }
    replayCount += 1;
    let result: Entry["result"];
    try {
      const raw = replayRaw(source);
      result = raw.ok
        ? ok({
            frames: raw.value.frames,
            history: freeze({
              frames: raw.value.frames.map((position, i) => ({
                fen: makeFen(position.toSetup()),
                ...raw.value.moves[i],
              })),
              sourceDigest: digest(source),
            }),
          })
        : raw;
    } catch (error) {
      result = err("infrastructure", "chess/failure", String(error));
    }
    const entry = {
      positions: result.ok ? result.value.frames.length : 0,
      result,
      sourceBytes: Buffer.byteLength(source),
    };
    entries.set(source, entry);
    if (!active.has(source)) {
      inactive.set(source, entry);
      inactivePositions += entry.positions;
      inactiveSourceBytes += entry.sourceBytes;
    }
    trim();
    return result;
  };
  const project = (position: Position) => {
    let value = projections.get(position);
    if (value === undefined) {
      value = freeze(positionData(position));
      projections.set(position, value);
    }
    return value;
  };
  const stats = () => ({
    entries: entries.size,
    inactiveEntries: inactive.size,
    inactivePositions,
    inactiveSourceBytes,
    positions: [...entries.values()].reduce(
      (sum, entry) => sum + entry.positions,
      0
    ),
  });
  return {
    project,
    replay,
    get replayCount() {
      return replayCount;
    },
    setActiveSources,
    stats,
  };
};

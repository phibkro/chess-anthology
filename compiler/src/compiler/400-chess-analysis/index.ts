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
  const frames = [position.clone()];
  const moves: { san: string | null; uci: string | null }[] = [
    { san: null, uci: null },
  ];
  // Validate every parsed branch even though this experiment only exposes mainline anchors.
  const validateTree = (
    node: (typeof games)[number]["moves"],
    pos: Position
  ): string | undefined => {
    for (const child of node.children) {
      const move = parseSan(pos, child.data.san);
      if (!move || !pos.isLegal(move)) {
        return `Illegal recorded move: ${child.data.san}`;
      }
      const next = pos.clone();
      next.play(move);
      const error = validateTree(child, next);
      if (error !== undefined) {
        return error;
      }
    }
    return undefined;
  };
  const issue = validateTree(games[0].moves, position);
  if (issue !== undefined) {
    return err("chess", "chess/illegal-move", issue);
  }
  for (const node of games[0].moves.mainline()) {
    const move = parseSan(position, node.san);
    if (!move) {
      return err("chess", "chess/illegal-move", `Illegal move: ${node.san}`);
    }
    moves.push({
      san: makeSan(position, move),
      uci: makeUci(normalizeMove(position, move)),
    });
    position.play(move);
    frames.push(position.clone());
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
 * @returns Create shared content-addressed replay analysis for one compiler instance.
 */
export const createChessAnalysis = () => {
  const entries = new Map<
    string,
    Result<{ frames: Position[]; history: GameHistory }>
  >();
  let replayCount = 0;
  const replay = (source: string) => {
    const key = digest(`chessops-0.15.1:standard-v1:${source}`);
    const hit = entries.get(key);
    if (hit) {
      return hit;
    }
    replayCount += 1;
    let result: Result<{ frames: Position[]; history: GameHistory }>;
    try {
      const raw = replayRaw(source);
      result = raw.ok
        ? ok({
            frames: raw.value.frames,
            history: freeze({
              frames: raw.value.frames.map((p, i) => ({
                fen: makeFen(p.toSetup()),
                ...raw.value.moves[i],
              })),
              sourceDigest: digest(source),
            }),
          })
        : raw;
    } catch (error) {
      result = err("infrastructure", "chess/failure", String(error));
    }
    entries.set(key, result);
    return result;
  };
  return {
    replay,
    get replayCount() {
      return replayCount;
    },
  };
};

import { parsePgn, startingPosition } from "chessops/pgn";
import { parseSan, makeSan } from "chessops/san";
import { makeFen } from "chessops/fen";
import { makeUci, parseSquare } from "chessops/util";
import type { Position } from "chessops/chess";
import type { SceneData, Issue } from "./model.js";

export function replay(source: string): { frames: Position[]; issue?: string } {
  const games = parsePgn(source);
  if (games.length !== 1) return { frames: [], issue: "Select exactly one PGN game." };
  const start = startingPosition(games[0].headers);
  if (start.isErr) return { frames: [], issue: "Invalid initial position." };
  const position = start.value;
  if (position.rules !== "chess")
    return { frames: [], issue: "This prototype supports standard chess and Chess960 only." };
  const frames = [position.clone()];
  // Validate every parsed branch even though this experiment only exposes mainline anchors.
  function validateTree(node: (typeof games)[number]["moves"], pos: Position): string | undefined {
    for (const child of node.children) {
      const move = parseSan(pos, child.data.san);
      if (!move || !pos.isLegal(move)) return `Illegal recorded move: ${child.data.san}`;
      const next = pos.clone();
      next.play(move);
      const error = validateTree(child, next);
      if (error) return error;
    }
  }
  const issue = validateTree(games[0].moves, position);
  if (issue) return { frames: [], issue };
  for (const node of games[0].moves.mainline()) {
    const move = parseSan(position, node.san);
    if (!move) return { frames: [], issue: `Illegal move: ${node.san}` };
    position.play(move);
    frames.push(position.clone());
  }
  return { frames };
}
export function legalMoves(position: Position) {
  return [...position.allDests()].flatMap(([from, dests]) =>
    [...dests].flatMap((to) => {
      const role = position.board.get(from)?.role;
      const promotions =
        role === "pawn" && (to < 8 || to >= 56)
          ? (["queen", "rook", "bishop", "knight"] as const)
          : [undefined];
      return promotions.map((promotion) => {
        const move = { from, to, promotion };
        return { san: makeSan(position, move), uci: makeUci(move) };
      });
    }),
  );
}
export function analyzeScene(scene: SceneData, frames: Position[]): Issue[] {
  const position = frames[scene.ply];
  if (!position)
    return [
      {
        code: "chess/missing-position",
        message: `No recorded position after ply ${scene.ply}.`,
        path: ["ply"],
      },
    ];
  return scene.notes.flatMap((note, i) => {
    if (note.type === "prompt") {
      const move = parseSan(position, note.answer);
      if (!move || !position.isLegal(move))
        return [
          {
            code: "chess/illegal-answer",
            message: `${note.answer} is not legal at this position.`,
            path: ["notes", i, "answer"],
          },
        ];
    }
    if (note.type === "arrow") {
      if (parseSquare(note.from) === undefined || parseSquare(note.to) === undefined)
        return [
          {
            code: "annotation/invalid-square",
            message: "Arrow endpoints must be chess squares.",
            path: ["notes", i, "from"],
          },
        ];
      if (!["green", "red", "blue", "yellow"].includes(note.color))
        return [
          {
            code: "annotation/unsupported-color",
            message: `Unsupported brush ${note.color}.`,
            path: ["notes", i, "color"],
          },
        ];
    }
    return [];
  });
}
export function positionData(position: Position) {
  return { fen: makeFen(position.toSetup()), legalMoves: legalMoves(position) };
}

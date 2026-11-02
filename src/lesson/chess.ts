import { Chess, normalizeMove, type Position } from "chessops/chess";
import { parseFen, makeFen } from "chessops/fen";
import {
  PgnParser,
  startingPosition,
  makePgn,
  type Game,
  type PgnNodeData,
  type Node,
} from "chessops/pgn";
import { parseSan } from "chessops/san";
import { makeUci, parseUci } from "chessops/util";

import { parseLesson, type Lesson, type LessonEvent } from "./schema";

interface Frame {
  fen: string;
  path: string[];
  san: string;
  comment: string;
}
export interface CompiledEvent {
  event: LessonEvent;
  cursor: number;
}
export interface CompiledLesson {
  content: Lesson;
  events: CompiledEvent[];
  frames: Frame[];
  game: Game<PgnNodeData>;
}
export const positionFromFen = (fen: string) =>
  Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
const pathKey = (path: string[]) => path.join(" ");

function checkTree(tree: Node<PgnNodeData>, position: Position): void {
  for (const child of tree.children) {
    const next = position.clone();
    const move = parseSan(next, child.data.san);
    if (!move || !next.isLegal(move))
      throw new Error(`Illegal move: ${child.data.san}`);
    next.play(move);
    checkTree(child, next);
  }
}

function readPgn(pgn: string): Game<PgnNodeData> {
  if (pgn.length > 131072) throw new Error("PGN must be smaller than 128 KiB.");
  const games: Game<PgnNodeData>[] = [];
  let parserError: Error | undefined;
  const parser = new PgnParser(
    (game, error) => {
      games.push(game);
      parserError ??= error;
    },
    undefined,
    100000
  );
  parser.parse(pgn);
  if (parserError) throw parserError;
  if (games.length !== 1)
    throw new Error("Import one game or composition at a time.");
  const game = games[0];
  if (!game.moves.children.length && !game.headers.has("FEN"))
    throw new Error("No moves or starting position found.");
  const variant = game.headers.get("Variant");
  if (variant && !["Standard", "From Position", "Chess"].includes(variant))
    throw new Error("This reader currently supports standard chess only.");
  const position = startingPosition(game.headers).unwrap();
  if (position.rules !== "chess") throw new Error("Unsupported chess rules.");
  checkTree(game.moves, position);
  return game;
}

export function compileLesson(input: unknown): CompiledLesson {
  const content = parseLesson(input);
  const game = readPgn(content.artifact.pgn);
  const position = startingPosition(game.headers).unwrap();
  const frames: Frame[] = [
    {
      fen: makeFen(position.toSetup()),
      path: [],
      san: "Start",
      comment: game.comments?.join(" ") ?? "",
    },
  ];
  for (const data of game.moves.mainline()) {
    const move = parseSan(position, data.san);
    if (!move) throw new Error(`Illegal move: ${data.san}`);
    const uci = makeUci(normalizeMove(position, move));
    position.play(move);
    frames.push({
      fen: makeFen(position.toSetup()),
      path: [...frames[frames.length - 1].path, uci],
      san: data.san,
      comment: data.comments?.join(" ") ?? "",
    });
  }
  const ids = new Set<string>();
  const promptAnchors = new Set<number>();
  const events = content.narrative.events.map((event): CompiledEvent => {
    if (ids.has(event.id))
      throw new Error(`Duplicate annotation ID: ${event.id}`);
    ids.add(event.id);
    const anchor = event.after;
    const cursor =
      typeof anchor === "number"
        ? anchor
        : frames.findIndex((frame) => pathKey(frame.path) === pathKey(anchor));
    const frame = frames[cursor];
    if (!frame) throw new Error(`Annotation anchor not found: ${event.id}`);
    if (event.type === "prompt") {
      if (promptAnchors.has(cursor))
        throw new Error("Only one prompt may occupy an anchor.");
      promptAnchors.add(cursor);
      const pos = positionFromFen(frame.fen);
      if (!event.hints.length || !event.accepted.length)
        throw new Error("A prompt needs hints and accepted moves.");
      for (const uci of event.accepted) {
        const move = parseUci(uci);
        if (!move || !pos.isLegal(move))
          throw new Error(`Illegal prompt answer: ${uci}`);
      }
      const next = frames[cursor + 1];
      if (
        !next ||
        event.accepted.some((uci) => uci !== next.path[next.path.length - 1])
      )
        throw new Error("Prototype prompts follow the recorded mainline.");
      const feedbackMoves = new Set<string>();
      for (const feedback of event.feedback) {
        const move = parseUci(feedback.move);
        if (
          !move ||
          !pos.isLegal(move) ||
          event.accepted.includes(feedback.move) ||
          feedbackMoves.has(feedback.move)
        )
          throw new Error(
            "Move feedback must name a unique legal alternative at its prompt anchor."
          );
        feedbackMoves.add(feedback.move);
      }
    }
    return { event, cursor };
  });
  return { content, frames, game, events };
}
export function eventsAt(
  lesson: CompiledLesson,
  cursor: number
): CompiledEvent[] {
  return lesson.events.filter((item) => item.cursor === cursor);
}

export function importPgn(pgn: string): CompiledLesson {
  const game = readPgn(pgn);
  return compileLesson({
    formatVersion: 1,
    id: "imported",
    artifact: {
      kind: "game",
      pgn: makePgn(game),
      source: {
        title: "Local import",
        url: "https://github.com/phibkro/chess-anthology",
        note: "Imported locally. Metadata and annotations have not been historically reviewed.",
      },
    },
    narrative: {
      title: game.headers.get("Event") || "Imported game",
      subtitle: `${game.headers.get("White") || "?"} — ${game.headers.get("Black") || "?"}`,
      introduction:
        "Explore the imported mainline. PGN variations and comments remain in the export. Review the normalized moves against your source before authoring a lesson.",
      events: [],
    },
  });
}
export function importFen(fen: string): CompiledLesson {
  const pos = positionFromFen(fen.trim());
  return importPgn(
    `[Event "Imported position"]\n[SetUp "1"]\n[FEN "${makeFen(pos.toSetup())}"]\n[Result "*"]\n\n*`
  );
}
export const exportPgn = (lesson: CompiledLesson) => makePgn(lesson.game);

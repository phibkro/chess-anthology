import { Chess, normalizeMove } from "chessops/chess";
import type { Position } from "chessops/chess";
import { parseFen, makeFen } from "chessops/fen";
import { PgnParser, startingPosition, makePgn } from "chessops/pgn";
import type { Game, PgnNodeData, Node } from "chessops/pgn";
import { parseSan } from "chessops/san";
import { makeUci, parseUci } from "chessops/util";

import { parseLesson } from "./schema";
import type { Lesson, LessonEvent } from "./schema";

interface Frame {
  fen: string;
  path: string[];
  san: string;
  comment: string;
}
/**
 * An annotation resolved to its mainline position index.
 */
export interface CompiledEvent {
  event: LessonEvent;
  cursor: number;
}
/**
 * A validated source game, recorded frames and resolved annotations.
 */
export interface CompiledLesson {
  content: Lesson;
  events: CompiledEvent[];
  frames: Frame[];
  game: Game<PgnNodeData>;
}
/**
 * Parse a standard-chess FEN into a private mutable engine position.
 * @param fen - A complete Forsyth–Edwards position.
 * @returns Parse a standard-chess FEN into a private mutable engine position.
 */
export const positionFromFen = (fen: string) =>
  Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
const pathKey = (path: string[]) => path.join(" ");

const checkTree = (tree: Node<PgnNodeData>, position: Position): void => {
  for (const child of tree.children) {
    const next = position.clone();
    const move = parseSan(next, child.data.san);
    if (!move || !next.isLegal(move)) {
      throw new Error(`Illegal move: ${child.data.san}`);
    }
    next.play(move);
    checkTree(child, next);
  }
};

const readPgn = (pgn: string): Game<PgnNodeData> => {
  if (pgn.length > 131_072) {
    throw new Error("PGN must be smaller than 128 KiB.");
  }
  const games: Game<PgnNodeData>[] = [];
  let parserError: Error | undefined;
  const parser = new PgnParser(
    (game, error) => {
      games.push(game);
      parserError ??= error;
    },
    undefined,
    100_000
  );
  parser.parse(pgn);
  if (parserError) {
    throw parserError;
  }
  if (games.length !== 1) {
    throw new Error("Import one game or composition at a time.");
  }
  const [game] = games;
  if (game === undefined) {
    throw new Error("The PGN contains no game.");
  }
  if (!game.moves.children.length && !game.headers.has("FEN")) {
    throw new Error("No moves or starting position found.");
  }
  const variant = game.headers.get("Variant");
  if (
    variant !== undefined &&
    !["Standard", "From Position", "Chess"].includes(variant)
  ) {
    throw new Error("This reader currently supports standard chess only.");
  }
  const position = startingPosition(game.headers).unwrap();
  if (position.rules !== "chess") {
    throw new Error("Unsupported chess rules.");
  }
  checkTree(game.moves, position);
  return game;
};

/**
 * Validate authored content and resolve annotations against legal recorded moves.
 * @param input - Untrusted content to validate at this boundary.
 * @returns Validate authored content and resolve annotations against legal recorded moves.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is an external-data validation boundary; accepting unknown prevents callers from assuming validation already happened.
export const compileLesson = (input: unknown): CompiledLesson => {
  const content = parseLesson(input);
  const game = readPgn(content.artifact.pgn);
  const position = startingPosition(game.headers).unwrap();
  const frames: Frame[] = [
    {
      comment: game.comments?.join(" ") ?? "",
      fen: makeFen(position.toSetup()),
      path: [],
      san: "Start",
    },
  ];
  for (const data of game.moves.mainline()) {
    const move = parseSan(position, data.san);
    if (!move) {
      throw new Error(`Illegal move: ${data.san}`);
    }
    const uci = makeUci(normalizeMove(position, move));
    position.play(move);
    frames.push({
      comment: data.comments?.join(" ") ?? "",
      fen: makeFen(position.toSetup()),
      path: [...(frames.at(-1)?.path ?? []), uci],
      san: data.san,
    });
  }
  const ids = new Set<string>();
  const promptAnchors = new Set<number>();
  const events = content.narrative.events.map((event): CompiledEvent => {
    if (ids.has(event.id)) {
      throw new Error(`Duplicate annotation ID: ${event.id}`);
    }
    ids.add(event.id);
    const anchor = event.after;
    const cursor = Array.isArray(anchor)
      ? frames.findIndex((frame) => pathKey(frame.path) === pathKey(anchor))
      : anchor;
    const frame = frames[cursor];
    if (cursor < 0 || cursor >= frames.length) {
      throw new Error(`Annotation anchor not found: ${event.id}`);
    }
    if (event.type === "prompt") {
      if (promptAnchors.has(cursor)) {
        throw new Error("Only one prompt may occupy an anchor.");
      }
      promptAnchors.add(cursor);
      const pos = positionFromFen(frame.fen);
      if (!event.hints.length || !event.accepted.length) {
        throw new Error("A prompt needs hints and accepted moves.");
      }
      for (const uci of event.accepted) {
        const move = parseUci(uci);
        if (!move || !pos.isLegal(move)) {
          throw new Error(`Illegal prompt answer: ${uci}`);
        }
      }
      const next = frames[cursor + 1];
      if (
        next === undefined ||
        event.accepted.some((uci) => uci !== next.path.at(-1))
      ) {
        throw new Error("Prototype prompts follow the recorded mainline.");
      }
      const feedbackMoves = new Set<string>();
      for (const feedback of event.feedback) {
        const move = parseUci(feedback.move);
        if (
          !move ||
          !pos.isLegal(move) ||
          event.accepted.includes(feedback.move) ||
          feedbackMoves.has(feedback.move)
        ) {
          throw new Error(
            "Move feedback must name a unique legal alternative at its prompt anchor."
          );
        }
        feedbackMoves.add(feedback.move);
      }
    }
    return { cursor, event };
  });
  return { content, events, frames, game };
};
/**
 * Select annotations attached to a recorded mainline cursor.
 * @param lesson - The compiled lesson being viewed.
 * @param cursor - Zero-based recorded position index.
 * @returns Annotations at the requested cursor.
 */
export const eventsAt = (
  lesson: CompiledLesson,
  cursor: number
): CompiledEvent[] => lesson.events.filter((item) => item.cursor === cursor);

/**
 * Import a single PGN into a local lesson while retaining its game tree.
 * @param pgn - A single recorded game or composition.
 * @returns Import a single PGN into a local lesson while retaining its game tree.
 */
export const importPgn = (pgn: string): CompiledLesson => {
  const game = readPgn(pgn);
  return compileLesson({
    artifact: {
      kind: "game",
      pgn: makePgn(game),
      source: {
        note: "Imported locally. Metadata and annotations have not been historically reviewed.",
        title: "Local import",
        url: "https://github.com/phibkro/chess-anthology",
      },
    },
    formatVersion: 1,
    id: "imported",
    narrative: {
      events: [],
      introduction:
        "Explore the imported mainline. PGN variations and comments remain in the export. Review the normalized moves against your source before authoring a lesson.",
      subtitle: `${game.headers.get("White") ?? "?"} — ${game.headers.get("Black") ?? "?"}`,
      title: game.headers.get("Event") ?? "Imported game",
    },
  });
};
/**
 * Import a FEN as a local position lesson.
 * @param fen - A complete Forsyth–Edwards position.
 * @returns Import a FEN as a local position lesson.
 */
export const importFen = (fen: string): CompiledLesson => {
  const pos = positionFromFen(fen.trim());
  return importPgn(
    `[Event "Imported position"]\n[SetUp "1"]\n[FEN "${makeFen(pos.toSetup())}"]\n[Result "*"]\n\n*`
  );
};
/**
 * Serialize the retained source game tree as PGN.
 * @param lesson - The compiled lesson being viewed.
 * @returns Serialize the retained source game tree as PGN.
 */
export const exportPgn = (lesson: CompiledLesson) => makePgn(lesson.game);

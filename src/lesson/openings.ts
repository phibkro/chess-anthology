import data from "../content/openings.json";
import { importPgn } from "./chess";
import type { CompiledLesson } from "./chess";

const openings = data.map((item) => ({
  ...item,
  path: importPgn(item.pgn).frames.at(-1)?.path ?? [],
}));
/**
 * Find the longest available opening prefix matching the recorded lesson.
 * @param lesson - The compiled lesson being viewed.
 * @returns The matching opening, when available.
 */
export const openingFor = (lesson: CompiledLesson) =>
  openings.find(
    (opening) =>
      opening.path.length > 0 &&
      opening.path.every(
        (move, index) =>
          lesson.frames[opening.path.length]?.path[index] === move
      )
  );

import data from "../content/openings.json";
import { importPgn, type CompiledLesson } from "./chess";

const openings = data.map((item) => ({
  ...item,
  path: importPgn(item.pgn).frames.at(-1)?.path ?? [],
}));
export function openingFor(lesson: CompiledLesson) {
  return openings.find(
    (opening) =>
      opening.path.length > 0 &&
      opening.path.every((move, index) => lesson.frames[opening.path.length]?.path[index] === move),
  );
}

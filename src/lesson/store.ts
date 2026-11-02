import { createStore } from "@xstate/store";
import { makeUci, parseUci } from "chessops/util";
import { normalizeMove } from "chessops/chess";
import { pathKey, positionFromFen, type CompiledLesson } from "./chess";

interface LessonContext {
  lesson: CompiledLesson;
  cursor: number;
  hints: number;
  feedback: string;
  revealed: boolean;
  practice: boolean;
  orientation: "white" | "black";
  attempts: number;
}
export function checkpointAt(context: LessonContext) {
  const frame = context.lesson.frames[context.cursor];
  return context.lesson.content.narrative.checkpoints.find(
    (checkpoint) => pathKey(checkpoint.path) === pathKey(frame.path),
  );
}
const moveCursor = (context: LessonContext, cursor: number): LessonContext => ({
  ...context,
  cursor: Math.max(0, Math.min(cursor, context.lesson.frames.length - 1)),
  hints: 0,
  feedback: "",
  revealed: false,
});
export function createLessonStore(lesson: CompiledLesson) {
  return createStore({
    context: {
      lesson,
      cursor: 0,
      hints: 0,
      feedback: "",
      revealed: false,
      practice: true,
      orientation: "white",
      attempts: 0,
    } as LessonContext,
    on: {
      load: (context, event: { lesson: CompiledLesson }) => ({
        ...moveCursor(context, 0),
        lesson: event.lesson,
        attempts: 0,
      }),
      next: (context) => moveCursor(context, context.cursor + 1),
      previous: (context) => moveCursor(context, context.cursor - 1),
      seek: (context, event: { cursor: number }) => moveCursor(context, event.cursor),
      reset: (context) => ({ ...moveCursor(context, 0), attempts: 0 }),
      hint: (context) => ({
        ...context,
        hints: Math.min(context.hints + 1, checkpointAt(context)?.hints.length ?? 0),
      }),
      reveal: (context) => ({
        ...context,
        revealed: true,
        feedback: checkpointAt(context)?.explanation ?? "",
      }),
      togglePractice: (context) => ({ ...context, practice: !context.practice, feedback: "" }),
      flip: (context) =>
        ({
          ...context,
          orientation: context.orientation === "white" ? "black" : "white",
        }) as LessonContext,
      submit: (context, event: { uci: string }) => {
        const checkpoint = checkpointAt(context);
        const nextFrame = context.lesson.frames[context.cursor + 1];
        if (!nextFrame) return context;
        const pos = positionFromFen(context.lesson.frames[context.cursor].fen);
        const move = parseUci(event.uci.trim().toLowerCase());
        if (!move || !pos.isLegal(move))
          return {
            ...context,
            attempts: context.attempts + 1,
            feedback: "That move is not legal in this position.",
          };
        const uci = makeUci(normalizeMove(pos, move));
        const accepted = checkpoint?.accepted ?? [nextFrame.path[nextFrame.path.length - 1]];
        if (!accepted.includes(uci))
          return {
            ...context,
            attempts: context.attempts + 1,
            feedback:
              checkpoint && context.practice
                ? "A legal move, but a different idea from the selected line. Try again, ask for a hint, or reveal."
                : "A legal move, but outside the recorded line. Follow the score or use the next-move arrow.",
          };
        return {
          ...moveCursor(context, context.cursor + 1),
          attempts: context.attempts + 1,
          feedback: checkpoint && context.practice ? `Found it. ${checkpoint.explanation}` : "",
        };
      },
    },
  });
}

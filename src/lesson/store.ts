import { createStore } from "@xstate/store";
import { normalizeMove } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { makeUci, parseUci } from "chessops/util";

import { eventsAt, positionFromFen } from "./chess";
import type { CompiledLesson } from "./chess";
import type { PromptEvent } from "./schema";

interface LessonContext {
  lesson: CompiledLesson;
  cursor: number;
  hints: number;
  feedback: string;
  feedbackTone: "neutral" | "encouraging" | "success";
  attempt: { fen: string; uci: string; san: string } | null;
  revealed: boolean;
  practice: boolean;
  orientation: "white" | "black";
  attempts: number;
}
/**
 * Select the prompt authored at the current lesson cursor.
 * @param context - Current reader-session state.
 * @returns The current prompt, when one is authored there.
 */
export const checkpointAt = (
  context: LessonContext
): PromptEvent | undefined => {
  const prompt = eventsAt(context.lesson, context.cursor).find(
    ({ event }) => event.type === "prompt"
  );
  return prompt?.event.type === "prompt" ? prompt.event : undefined;
};
const moveCursor = (context: LessonContext, cursor: number): LessonContext => ({
  ...context,
  attempt: null,
  cursor: Math.max(0, Math.min(cursor, context.lesson.frames.length - 1)),
  feedback: "",
  feedbackTone: "neutral",
  hints: 0,
  revealed: false,
});
/**
 * Create a lesson session with cursor, hints and constructive move feedback.
 * @param lesson - The compiled lesson being viewed.
 * @returns Create a lesson session with cursor, hints and constructive move feedback.
 */
export const createLessonStore = (lesson: CompiledLesson) => {
  const initial: LessonContext = {
    attempt: null,
    attempts: 0,
    cursor: 0,
    feedback: "",
    feedbackTone: "neutral",
    hints: 0,
    lesson,
    orientation: "white",
    practice: true,
    revealed: false,
  };
  return createStore({
    context: initial,
    on: {
      flip: (context) => ({
        ...context,
        orientation: context.orientation === "white" ? "black" : "white",
      }),
      hint: (context) => ({
        ...context,
        hints: Math.min(
          context.hints + 1,
          checkpointAt(context)?.hints.length ?? 0
        ),
      }),
      load: (context, event: { lesson: CompiledLesson }) => ({
        ...moveCursor(context, 0),
        attempts: 0,
        lesson: event.lesson,
      }),
      next: (context) =>
        context.attempt ? context : moveCursor(context, context.cursor + 1),
      previous: (context) =>
        context.attempt
          ? { ...context, attempt: null, feedback: "", revealed: false }
          : moveCursor(context, context.cursor - 1),
      reset: (context) => ({ ...moveCursor(context, 0), attempts: 0 }),
      retry: (context) => ({
        ...context,
        attempt: null,
        feedback: "",
        feedbackTone: "neutral",
        revealed: false,
      }),
      reveal: (context) => ({
        ...context,
        attempt: null,
        feedback: checkpointAt(context)?.explanation ?? "",
        feedbackTone: "neutral",
        revealed: true,
      }),
      seek: (context, event: { cursor: number }) =>
        moveCursor(context, event.cursor),
      submit: (context, event: { uci: string }): LessonContext => {
        if (context.attempt) {
          return context;
        }
        const checkpoint = checkpointAt(context);
        const nextFrame = context.lesson.frames.at(context.cursor + 1);
        if (!nextFrame) {
          return context;
        }
        const pos = positionFromFen(context.lesson.frames[context.cursor].fen);
        const move = parseUci(event.uci.trim().toLowerCase());
        if (!move || !pos.isLegal(move)) {
          return {
            ...context,
            attempts: context.attempts + 1,
            feedback: "Choose a legal move, then try again.",
            feedbackTone: "neutral",
          };
        }
        const normalized = normalizeMove(pos, move);
        const uci = makeUci(normalized);
        const accepted = checkpoint?.accepted ?? [nextFrame.path.at(-1)];
        if (!accepted.includes(uci)) {
          const san = makeSan(pos, normalized);
          pos.play(normalized);
          const authored = context.practice
            ? checkpoint?.feedback.find((item) => item.move === uci)
            : undefined;
          return {
            ...context,
            attempt: { fen: makeFen(pos.toSetup()), san, uci },
            attempts: context.attempts + 1,
            feedback: authored?.message ?? "Try again.",
            feedbackTone: authored ? "encouraging" : "neutral",
            revealed: false,
          };
        }
        return {
          ...moveCursor(context, context.cursor + 1),
          attempts: context.attempts + 1,
          feedback:
            checkpoint && context.practice
              ? `Nice find. ${checkpoint.explanation}`
              : "",
          feedbackTone: checkpoint && context.practice ? "success" : "neutral",
        };
      },
      togglePractice: (context) => ({
        ...context,
        practice: !context.practice,
      }),
    },
  });
};

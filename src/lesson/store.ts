import { createStore } from "@xstate/store";
import { normalizeMove } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { makeUci, parseUci } from "chessops/util";

import { eventsAt, positionFromFen, type CompiledLesson } from "./chess";
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
export function checkpointAt(context: LessonContext): PromptEvent | undefined {
  const prompt = eventsAt(context.lesson, context.cursor).find(
    ({ event }) => event.type === "prompt"
  );
  return prompt?.event.type === "prompt" ? prompt.event : undefined;
}
const moveCursor = (context: LessonContext, cursor: number): LessonContext => ({
  ...context,
  cursor: Math.max(0, Math.min(cursor, context.lesson.frames.length - 1)),
  hints: 0,
  feedback: "",
  feedbackTone: "neutral",
  attempt: null,
  revealed: false,
});
export function createLessonStore(lesson: CompiledLesson) {
  const initial: LessonContext = {
    lesson,
    cursor: 0,
    hints: 0,
    feedback: "",
    feedbackTone: "neutral",
    attempt: null,
    revealed: false,
    practice: true,
    orientation: "white",
    attempts: 0,
  };
  return createStore({
    context: initial,
    on: {
      load: (context, event: { lesson: CompiledLesson }) => ({
        ...moveCursor(context, 0),
        lesson: event.lesson,
        attempts: 0,
      }),
      next: (context) =>
        context.attempt ? context : moveCursor(context, context.cursor + 1),
      previous: (context) =>
        context.attempt
          ? { ...context, attempt: null, feedback: "", revealed: false }
          : moveCursor(context, context.cursor - 1),
      seek: (context, event: { cursor: number }) =>
        moveCursor(context, event.cursor),
      reset: (context) => ({ ...moveCursor(context, 0), attempts: 0 }),
      retry: (context) =>
        ({
          ...context,
          attempt: null,
          feedback: "",
          feedbackTone: "neutral",
          revealed: false,
        }) as LessonContext,
      hint: (context) => ({
        ...context,
        hints: Math.min(
          context.hints + 1,
          checkpointAt(context)?.hints.length ?? 0
        ),
      }),
      reveal: (context) =>
        ({
          ...context,
          attempt: null,
          revealed: true,
          feedback: checkpointAt(context)?.explanation ?? "",
          feedbackTone: "neutral",
        }) as LessonContext,
      togglePractice: (context) => ({
        ...context,
        practice: !context.practice,
      }),
      flip: (context) =>
        ({
          ...context,
          orientation: context.orientation === "white" ? "black" : "white",
        }) as LessonContext,
      submit: (context, event: { uci: string }): LessonContext => {
        if (context.attempt) return context;
        const checkpoint = checkpointAt(context);
        const nextFrame = context.lesson.frames[context.cursor + 1];
        if (!nextFrame) return context;
        const pos = positionFromFen(context.lesson.frames[context.cursor].fen);
        const move = parseUci(event.uci.trim().toLowerCase());
        if (!move || !pos.isLegal(move))
          return {
            ...context,
            attempts: context.attempts + 1,
            feedback: "Choose a legal move, then try again.",
            feedbackTone: "neutral",
          };
        const normalized = normalizeMove(pos, move);
        const uci = makeUci(normalized);
        const accepted = checkpoint?.accepted ?? [
          nextFrame.path[nextFrame.path.length - 1],
        ];
        if (!accepted.includes(uci)) {
          const san = makeSan(pos, normalized);
          pos.play(normalized);
          const authored = context.practice
            ? checkpoint?.feedback.find((item) => item.move === uci)
            : undefined;
          return {
            ...context,
            attempt: { fen: makeFen(pos.toSetup()), uci, san },
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
    },
  });
}

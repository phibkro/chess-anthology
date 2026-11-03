import type { PlaybackPlan } from "@chess-anthology/compiler/playback";
import { createStore } from "@xstate/store";
import { normalizeMove } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { parseUci, makeUci } from "chessops/util";

import { positionFromFen } from "../lesson";

interface StoryContext {
  attempt: { fen: string; san: string } | null;
  attempts: number;
  feedback: string;
  orientation: "white" | "black";
  ply: number;
  revealed: boolean;
  scene: number;
  success: boolean;
}

/**
 * Create independent playback state and reader tries for a compiled story.
 * @param plan - The validated playback plan.
 * @returns Create independent playback state and reader tries for a compiled story.
 */
export const createStoryStore = (plan: PlaybackPlan) => {
  const initial: StoryContext = {
    attempt: null,
    attempts: 0,
    feedback: "",
    orientation: "white",
    ply: plan.scenes[0].after,
    revealed: false,
    scene: 0,
    success: false,
  };
  const clean = {
    attempt: null,
    feedback: "",
    revealed: false,
    success: false,
  };
  return createStore({
    context: initial,
    on: {
      flip: (context) => ({
        ...context,
        orientation:
          context.orientation === "white"
            ? ("black" as const)
            : ("white" as const),
      }),
      next: (context) =>
        context.attempt ||
        context.ply >= plan.scenes[context.scene].frames.length - 1
          ? context
          : { ...context, ...clean, ply: context.ply + 1 },
      previous: (context) =>
        context.attempt
          ? { ...context, ...clean }
          : { ...context, ...clean, ply: Math.max(0, context.ply - 1) },
      restart: (context) => ({
        ...context,
        ...clean,
        ply: plan.scenes[context.scene].after,
      }),
      retry: (context) => ({ ...context, ...clean }),
      reveal: (context) => ({ ...context, ...clean, revealed: true }),
      seek: (context, event: { ply: number }) =>
        Number.isInteger(event.ply) &&
        event.ply >= 0 &&
        event.ply < plan.scenes[context.scene].frames.length
          ? { ...context, ...clean, ply: event.ply }
          : context,
      selectScene: (context, event: { index: number }) =>
        Number.isInteger(event.index) &&
        event.index >= 0 &&
        event.index < plan.scenes.length
          ? {
              ...context,
              ...clean,
              ply: plan.scenes[event.index].after,
              scene: event.index,
            }
          : context,
      submit: (context, event: { uci: string }) => {
        const scene = plan.scenes[context.scene];
        if (context.attempt || context.ply + 1 >= scene.frames.length) {
          return context;
        }
        const position = positionFromFen(scene.frames[context.ply].fen);
        const move = parseUci(event.uci);
        if (!move || !position.isLegal(move)) {
          return {
            ...context,
            feedback: "Choose a legal move, then try again.",
            success: false,
          };
        }
        const normalized = normalizeMove(position, move);
        const uci = makeUci(normalized);
        const prompt =
          context.ply === scene.after
            ? scene.notes.find((n) => n.type === "prompt")
            : undefined;
        const expected =
          prompt?.type === "prompt"
            ? prompt.answerUci
            : scene.frames[context.ply + 1].uci;
        if (uci !== expected) {
          const san = makeSan(position, normalized);
          position.play(normalized);
          return {
            ...context,
            attempt: { fen: makeFen(position.toSetup()), san },
            attempts: context.attempts + 1,
            feedback: "Try again.",
            success: false,
          };
        }
        return {
          ...context,
          ...clean,
          attempts: context.attempts + 1,
          feedback: prompt ? "Nice find." : "",
          ply: context.ply + 1,
          success: Boolean(prompt),
        };
      },
    },
  });
};

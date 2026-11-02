import { createStore } from "@xstate/store";
import type { PlaybackPlan } from "chess-compiler-prototype/playback";
import { normalizeMove } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { parseUci, makeUci } from "chessops/util";

import { positionFromFen } from "../lesson";

export function createStoryStore(plan: PlaybackPlan) {
  const initial = {
    scene: 0,
    ply: plan.scenes[0].after,
    orientation: "white" as "white" | "black",
    attempt: null as { fen: string; san: string } | null,
    feedback: "",
    success: false,
    revealed: false,
    attempts: 0,
  };
  const clean = {
    attempt: null,
    feedback: "",
    success: false,
    revealed: false,
  };
  return createStore({
    context: initial,
    on: {
      selectScene: (context, event: { index: number }) =>
        Number.isInteger(event.index) && plan.scenes[event.index]
          ? {
              ...context,
              ...clean,
              scene: event.index,
              ply: plan.scenes[event.index].after,
            }
          : context,
      seek: (context, event: { ply: number }) =>
        Number.isInteger(event.ply) &&
        plan.scenes[context.scene].frames[event.ply]
          ? { ...context, ...clean, ply: event.ply }
          : context,
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
      flip: (context) => ({
        ...context,
        orientation:
          context.orientation === "white"
            ? ("black" as const)
            : ("white" as const),
      }),
      submit: (context, event: { uci: string }) => {
        const scene = plan.scenes[context.scene];
        if (context.attempt || !scene.frames[context.ply + 1]) return context;
        const position = positionFromFen(scene.frames[context.ply].fen);
        const move = parseUci(event.uci);
        if (!move || !position.isLegal(move))
          return {
            ...context,
            feedback: "Choose a legal move, then try again.",
            success: false,
          };
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
            feedback: "Try again.",
            success: false,
            attempts: context.attempts + 1,
          };
        }
        return {
          ...context,
          ...clean,
          ply: context.ply + 1,
          feedback: prompt ? "Nice find." : "",
          success: Boolean(prompt),
          attempts: context.attempts + 1,
        };
      },
    },
  });
}

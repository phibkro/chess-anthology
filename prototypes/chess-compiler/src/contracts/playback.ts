import * as v from "valibot";

import { ok, err } from "./core.js";
import type { Result } from "./core.js";

const square = v.pipe(v.string(), v.regex(/^[a-h][1-8]$/u));
const uci = v.pipe(v.string(), v.regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/u));
const frame = v.strictObject({
  fen: v.string(),
  san: v.nullable(v.string()),
  uci: v.nullable(uci),
});
const note = v.variant("type", [
  v.strictObject({ text: v.string(), type: v.literal("text") }),
  v.strictObject({
    color: v.picklist(["green", "red", "blue", "yellow"]),
    from: square,
    to: square,
    type: v.literal("arrow"),
  }),
  v.strictObject({
    answer: v.string(),
    answerUci: uci,
    text: v.string(),
    type: v.literal("prompt"),
  }),
]);
const schema = v.strictObject({
  format: v.literal("chess-playback-plan"),
  id: v.string(),
  scenes: v.pipe(
    v.array(
      v.strictObject({
        after: v.pipe(v.number(), v.integer(), v.minValue(0)),
        frames: v.array(frame),
        game: v.string(),
        id: v.string(),
        notes: v.array(note),
        sourceDigest: v.string(),
      })
    ),
    v.minLength(1)
  ),
  version: v.literal(1),
});
/**
 * A versioned browser-safe story plan with recorded frames and annotations.
 */
export type PlaybackPlan = v.InferOutput<typeof schema>;
/**
 * Validate an externally supplied browser playback plan.
 * @param input - Untrusted content to validate at this boundary.
 * @returns A validated playback plan or a schema failure.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is an external-data validation boundary; accepting unknown prevents callers from assuming validation already happened.
export const parsePlaybackPlan = (input: unknown): Result<PlaybackPlan> => {
  const parsed = v.safeParse(schema, input);
  return parsed.success
    ? ok(parsed.output)
    : err("schema", "plan/invalid-shape", "Invalid playback plan.");
};

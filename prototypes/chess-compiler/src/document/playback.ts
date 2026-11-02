import * as v from "valibot";

import { ok, err, type Result } from "./index.js";
const square = v.pipe(v.string(), v.regex(/^[a-h][1-8]$/));
const uci = v.pipe(v.string(), v.regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/));
const frame = v.strictObject({
  fen: v.string(),
  san: v.nullable(v.string()),
  uci: v.nullable(uci),
});
const note = v.variant("type", [
  v.strictObject({ type: v.literal("text"), text: v.string() }),
  v.strictObject({
    type: v.literal("arrow"),
    from: square,
    to: square,
    color: v.picklist(["green", "red", "blue", "yellow"]),
  }),
  v.strictObject({
    type: v.literal("prompt"),
    text: v.string(),
    answer: v.string(),
    answerUci: uci,
  }),
]);
const schema = v.strictObject({
  format: v.literal("chess-playback-plan"),
  version: v.literal(1),
  id: v.string(),
  scenes: v.pipe(
    v.array(
      v.strictObject({
        id: v.string(),
        game: v.string(),
        after: v.pipe(v.number(), v.integer(), v.minValue(0)),
        sourceDigest: v.string(),
        frames: v.array(frame),
        notes: v.array(note),
      })
    ),
    v.minLength(1)
  ),
});
export type PlaybackPlan = v.InferOutput<typeof schema>;
export function parsePlaybackPlan(input: unknown): Result<PlaybackPlan> {
  const parsed = v.safeParse(schema, input);
  return parsed.success
    ? ok(parsed.output)
    : err("schema", "plan/invalid-shape", "Invalid playback plan.");
}

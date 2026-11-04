import * as v from "valibot";

import { err, ok } from "./core.js";
import type { Result } from "./core.js";
import { playbackSchema, parsePlaybackPlan } from "./playback.js";

const schema = v.strictObject({
  format: v.literal("chess-playback-collection"),
  id: v.string(),
  stories: v.array(v.strictObject({ id: v.string(), plan: playbackSchema })),
  title: v.string(),
  version: v.literal(1),
});
/** An ordered projection of nested collection members into independent story plans. */
export type PlaybackCollection = v.InferOutput<typeof schema>;

/* oxlint-disable anti-slop/no-unknown-parameters -- Validate externally supplied collection data at the public boundary. */
/** Validate a portable collection and each story's history references.
 * @param input - Untrusted collection data.
 * @returns The validated collection or a shape/integrity error.
 */
export const parsePlaybackCollection = (
  input: unknown
): Result<PlaybackCollection> => {
  const parsed = v.safeParse(schema, input);
  if (!parsed.success) {
    return err(
      "schema",
      "collection/invalid-shape",
      "Invalid playback collection."
    );
  }
  const ids = new Set<string>();
  for (const item of parsed.output.stories) {
    if (ids.has(item.id)) {
      return err(
        "integrity",
        "collection/duplicate-occurrence",
        `Duplicate story occurrence ${item.id}.`
      );
    }
    ids.add(item.id);
    const plan = parsePlaybackPlan(item.plan);
    if (!plan.ok) {
      return plan;
    }
  }
  return ok(parsed.output);
};

/* oxlint-enable anti-slop/no-unknown-parameters */

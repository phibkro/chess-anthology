import * as v from "valibot";

import { metadataSchema } from "./authored.js";
import { ok, err } from "./core.js";
import type { Result } from "./core.js";
import { markdownSchema } from "./markdown.js";

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
const sceneFields = {
  after: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
  game: v.string(),
  id: v.string(),
  notes: v.array(note),
  sourceDigest: v.string(),
};
const legacy = v.strictObject({
  format: v.literal("chess-playback-plan"),
  id: v.string(),
  scenes: v.pipe(
    v.array(
      v.strictObject({
        ...sceneFields,
        frames: v.pipe(v.array(frame), v.minLength(1)),
      })
    ),
    v.minLength(1)
  ),
  version: v.literal(1),
});
const schema = v.strictObject({
  format: v.literal("chess-playback-plan"),
  histories: v.record(
    v.string(),
    v.strictObject({ frames: v.pipe(v.array(frame), v.minLength(1)) })
  ),
  id: v.string(),
  scenes: v.pipe(
    v.array(v.strictObject({ ...sceneFields, historyId: v.string() })),
    v.minLength(1)
  ),
  version: v.literal(2),
});
const richSchema = v.strictObject({
  ...schema.entries,
  metadata: metadataSchema,
  scenes: v.pipe(
    v.array(
      v.strictObject({
        ...sceneFields,
        historyId: v.string(),
        notes: v.array(
          v.variant("type", [
            ...note.options,
            v.strictObject({
              content: markdownSchema,
              type: v.literal("markdown"),
            }),
          ])
        ),
        title: v.string(),
      })
    ),
    v.minLength(1)
  ),
  title: v.string(),
  version: v.literal(3),
});
/** Canonical playback versions embedded by collection consumers. */
export const playbackSchema = v.variant("version", [schema, richSchema]);
/**
 * A versioned browser-safe story plan with recorded frames and annotations.
 */
export type PlaybackPlan =
  | v.InferOutput<typeof schema>
  | v.InferOutput<typeof richSchema>;
/**
 * Validate an externally supplied browser playback plan.
 * @param input - Untrusted content to validate at this boundary.
 * @returns A validated playback plan or a schema failure.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is an external-data validation boundary; accepting unknown prevents callers from assuming validation already happened.
export const parsePlaybackPlan = (input: unknown): Result<PlaybackPlan> => {
  const parsed = v.safeParse(
    v.variant("version", [legacy, schema, richSchema]),
    input
  );
  if (!parsed.success) {
    return err("schema", "plan/invalid-shape", "Invalid playback plan.");
  }
  let plan: PlaybackPlan;
  if (parsed.output.version === 1) {
    const histories: PlaybackPlan["histories"] = {};
    const identities = new Map<string, string>();
    const scenes: v.InferOutput<typeof schema>["scenes"] = [];
    for (const { frames, ...scene } of parsed.output.scenes) {
      const identity = JSON.stringify(frames);
      const prior = identities.get(scene.sourceDigest);
      if (prior !== undefined && prior !== identity) {
        return err(
          "integrity",
          "plan/conflicting-history",
          "One source digest identifies conflicting game histories."
        );
      }
      identities.set(scene.sourceDigest, identity);
      Object.defineProperty(histories, scene.sourceDigest, {
        configurable: true,
        enumerable: true,
        value: { frames },
        writable: true,
      });
      scenes.push({ ...scene, historyId: scene.sourceDigest });
    }
    plan = {
      format: parsed.output.format,
      histories,
      id: parsed.output.id,
      scenes,
      version: 2,
    };
  } else {
    plan = parsed.output;
  }
  const ids = new Set<string>();
  for (const scene of plan.scenes) {
    const history = Object.hasOwn(plan.histories, scene.historyId)
      ? plan.histories[scene.historyId]
      : undefined;
    if (
      history === undefined ||
      scene.historyId !== scene.sourceDigest ||
      scene.after >= history.frames.length ||
      ids.has(scene.id)
    ) {
      return err(
        "integrity",
        "plan/invalid-reference",
        "A scene must identify a recorded position in one unique game history."
      );
    }
    ids.add(scene.id);
  }
  return ok(plan);
};

/**
 * Select a validated scene's shared recorded frames.
 * @param plan - Validated normalized playback plan.
 * @param scene - A scene belonging to that plan.
 * @returns The history array shared by every occurrence of this game.
 */
export const playbackFrames = (
  plan: PlaybackPlan,
  scene: PlaybackPlan["scenes"][number]
) => plan.histories[scene.historyId].frames;

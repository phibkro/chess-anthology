import * as v from "valibot";

const UciSchema = v.pipe(v.string(), v.regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/u));
const PathSchema = v.array(UciSchema);
const AnchorSchema = v.union([
  v.pipe(v.number(), v.integer(), v.minValue(0)),
  PathSchema,
]);
const PromptFields = {
  accepted: v.array(UciSchema),
  explanation: v.string(),
  feedback: v.optional(
    v.array(
      v.strictObject({
        message: v.pipe(v.string(), v.minLength(1)),
        move: UciSchema,
      })
    ),
    []
  ),
  hints: v.array(v.string()),
  prompt: v.string(),
};
const EventAnchor = {
  after: AnchorSchema,
  id: v.pipe(v.string(), v.minLength(1)),
};
const EventSchema = v.variant("type", [
  v.strictObject({
    ...EventAnchor,
    text: v.pipe(v.string(), v.minLength(1)),
    type: v.literal("text"),
  }),
  v.strictObject({
    ...EventAnchor,
    type: v.literal("prompt"),
    ...PromptFields,
  }),
]);
const ArtifactSchema = v.strictObject({
  kind: v.picklist(["composition", "game"]),
  pgn: v.pipe(v.string(), v.maxLength(131_072)),
  source: v.strictObject({
    note: v.string(),
    title: v.string(),
    url: v.pipe(
      v.string(),
      v.url(),
      v.check(
        (url) => ["https:", "http:"].includes(new URL(url).protocol),
        "Source links must use HTTP(S)."
      )
    ),
  }),
  stipulation: v.optional(v.string()),
});
const NarrativeFields = {
  introduction: v.string(),
  subtitle: v.string(),
  title: v.string(),
};
const LessonSchema = v.strictObject({
  artifact: ArtifactSchema,
  formatVersion: v.literal(1),
  id: v.pipe(v.string(), v.minLength(1)),
  narrative: v.strictObject({
    ...NarrativeFields,
    events: v.array(EventSchema),
  }),
});
const LegacySchema = v.strictObject({
  artifact: ArtifactSchema,
  id: v.pipe(v.string(), v.minLength(1)),
  narrative: v.strictObject({
    ...NarrativeFields,
    checkpoints: v.array(v.strictObject({ path: PathSchema, ...PromptFields })),
  }),
});
/**
 * A validated version-one authored lesson and its source attribution.
 */
export type Lesson = v.InferOutput<typeof LessonSchema>;
/**
 * An authored annotation anchored to a recorded position.
 */
export type LessonEvent = Lesson["narrative"]["events"][number];
/**
 * An interactive prompt with supported moves and constructive feedback.
 */
export type PromptEvent = Extract<LessonEvent, { type: "prompt" }>;

/**
 * Validate a lesson and normalize supported legacy input.
 * @param input - Untrusted content to validate at this boundary.
 * @returns Validate a lesson and normalize supported legacy input.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is an external-data validation boundary; accepting unknown prevents callers from assuming validation already happened.
export const parseLesson = (input: unknown): Lesson => {
  if (
    v.is(v.record(v.string(), v.unknown()), input) &&
    "formatVersion" in input
  ) {
    return v.parse(LessonSchema, input);
  }
  const legacy = v.parse(LegacySchema, input);
  return v.parse(LessonSchema, {
    artifact: legacy.artifact,
    formatVersion: 1,
    id: legacy.id,
    narrative: {
      events: legacy.narrative.checkpoints.map(
        ({ path, ...prompt }, index) => ({
          after: path,
          id: `prompt-${index + 1}`,
          type: "prompt",
          ...prompt,
        })
      ),
      introduction: legacy.narrative.introduction,
      subtitle: legacy.narrative.subtitle,
      title: legacy.narrative.title,
    },
  });
};

import * as v from "valibot";

const UciSchema = v.pipe(v.string(), v.regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/));
const PathSchema = v.array(UciSchema);
const AnchorSchema = v.union([
  v.pipe(v.number(), v.integer(), v.minValue(0)),
  PathSchema,
]);
const PromptFields = {
  prompt: v.string(),
  hints: v.array(v.string()),
  explanation: v.string(),
  accepted: v.array(UciSchema),
  feedback: v.optional(
    v.array(
      v.strictObject({
        move: UciSchema,
        message: v.pipe(v.string(), v.minLength(1)),
      })
    ),
    []
  ),
};
const EventAnchor = {
  id: v.pipe(v.string(), v.minLength(1)),
  after: AnchorSchema,
};
const EventSchema = v.variant("type", [
  v.strictObject({
    ...EventAnchor,
    type: v.literal("text"),
    text: v.pipe(v.string(), v.minLength(1)),
  }),
  v.strictObject({
    ...EventAnchor,
    type: v.literal("prompt"),
    ...PromptFields,
  }),
]);
const ArtifactSchema = v.strictObject({
  kind: v.picklist(["composition", "game"]),
  pgn: v.pipe(v.string(), v.maxLength(131072)),
  source: v.strictObject({
    title: v.string(),
    url: v.pipe(
      v.string(),
      v.url(),
      v.check(
        (url) => ["https:", "http:"].includes(new URL(url).protocol),
        "Source links must use HTTP(S)."
      )
    ),
    note: v.string(),
  }),
  stipulation: v.optional(v.string()),
});
const NarrativeFields = {
  title: v.string(),
  subtitle: v.string(),
  introduction: v.string(),
};
const LessonSchema = v.strictObject({
  formatVersion: v.literal(1),
  id: v.pipe(v.string(), v.minLength(1)),
  artifact: ArtifactSchema,
  narrative: v.strictObject({
    ...NarrativeFields,
    events: v.array(EventSchema),
  }),
});
const LegacySchema = v.strictObject({
  id: v.pipe(v.string(), v.minLength(1)),
  artifact: ArtifactSchema,
  narrative: v.strictObject({
    ...NarrativeFields,
    checkpoints: v.array(v.strictObject({ path: PathSchema, ...PromptFields })),
  }),
});
export type Lesson = v.InferOutput<typeof LessonSchema>;
export type LessonEvent = Lesson["narrative"]["events"][number];
export type PromptEvent = Extract<LessonEvent, { type: "prompt" }>;

export function parseLesson(input: unknown): Lesson {
  if (typeof input === "object" && input !== null && "formatVersion" in input)
    return v.parse(LessonSchema, input);
  const legacy = v.parse(LegacySchema, input);
  return v.parse(LessonSchema, {
    formatVersion: 1,
    id: legacy.id,
    artifact: legacy.artifact,
    narrative: {
      title: legacy.narrative.title,
      subtitle: legacy.narrative.subtitle,
      introduction: legacy.narrative.introduction,
      events: legacy.narrative.checkpoints.map(
        ({ path, ...prompt }, index) => ({
          id: `prompt-${index + 1}`,
          type: "prompt",
          after: path,
          ...prompt,
        })
      ),
    },
  });
}

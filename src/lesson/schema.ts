import * as v from "valibot";

const PathSchema = v.array(v.pipe(v.string(), v.regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/)));
const CheckpointSchema = v.object({
  path: PathSchema,
  prompt: v.string(),
  hints: v.array(v.string()),
  explanation: v.string(),
  accepted: PathSchema,
});
export const LessonSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  artifact: v.object({
    kind: v.picklist(["composition", "game"]),
    pgn: v.pipe(v.string(), v.maxLength(131072)),
    source: v.object({
      title: v.string(),
      url: v.pipe(
        v.string(),
        v.url(),
        v.check(
          (url) => ["https:", "http:"].includes(new URL(url).protocol),
          "Source links must use HTTP(S).",
        ),
      ),
      note: v.string(),
    }),
    stipulation: v.optional(v.string()),
  }),
  narrative: v.object({
    title: v.string(),
    subtitle: v.string(),
    introduction: v.string(),
    checkpoints: v.array(CheckpointSchema),
  }),
});
export type Lesson = v.InferOutput<typeof LessonSchema>;

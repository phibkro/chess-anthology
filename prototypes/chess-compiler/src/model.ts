// PROTOTYPE: plain authored data, independent of Langium's object graph.
import * as v from "valibot";
const reserved = [
  "module",
  "import",
  "export",
  "game",
  "from",
  "story",
  "board",
  "after",
  "text",
  "arrow",
  "prompt",
  "answer",
];
const Identifier = v.pipe(
  v.string(),
  v.regex(/^[_a-zA-Z][_a-zA-Z0-9]*$/),
  v.check((s) => !reserved.includes(s), "Reserved keyword"),
);
const Note = v.variant("type", [
  v.strictObject({ type: v.literal("text"), text: v.string() }),
  v.strictObject({ type: v.literal("arrow"), from: v.string(), to: v.string(), color: Identifier }),
  v.strictObject({ type: v.literal("prompt"), text: v.string(), answer: v.string() }),
]);
export const ModuleSchema = v.strictObject({
  formatVersion: v.literal(0),
  name: Identifier,
  imports: v.array(v.string()),
  games: v.array(v.strictObject({ name: Identifier, exported: v.boolean(), source: v.string() })),
  stories: v.array(
    v.strictObject({
      name: Identifier,
      scenes: v.array(
        v.strictObject({
          name: Identifier,
          game: Identifier,
          ply: v.pipe(v.number(), v.integer(), v.minValue(0)),
          notes: v.array(Note),
        }),
      ),
    }),
  ),
});
export type DocumentData = v.InferOutput<typeof ModuleSchema>;
export type SceneData = DocumentData["stories"][number]["scenes"][number];
export type Issue = { code: string; message: string; path: (string | number)[] };
export function parseStructured(input: unknown): DocumentData {
  return v.parse(ModuleSchema, input);
}

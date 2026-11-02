// PROTOTYPE: plain authored data, independent of Langium's object graph.
import * as v from "valibot";

import { ok } from "./core.js";
import type { Result } from "./core.js";

const reserved = new Set([
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
]);
const Identifier = v.pipe(
  v.string(),
  v.regex(/^[_a-zA-Z][_a-zA-Z0-9]*$/u),
  v.check((s) => !reserved.has(s), "Reserved keyword")
);
const Note = v.variant("type", [
  v.strictObject({ text: v.string(), type: v.literal("text") }),
  v.strictObject({
    color: Identifier,
    from: v.string(),
    to: v.string(),
    type: v.literal("arrow"),
  }),
  v.strictObject({
    answer: v.string(),
    text: v.string(),
    type: v.literal("prompt"),
  }),
]);
const ModuleSchema = v.strictObject({
  formatVersion: v.literal(0),
  games: v.array(
    v.strictObject({
      exported: v.boolean(),
      name: Identifier,
      source: v.string(),
    })
  ),
  imports: v.array(v.string()),
  name: Identifier,
  stories: v.array(
    v.strictObject({
      name: Identifier,
      scenes: v.array(
        v.strictObject({
          game: Identifier,
          name: Identifier,
          notes: v.array(Note),
          ply: v.pipe(
            v.number(),
            v.integer(),
            v.minValue(0),
            v.maxValue(Number.MAX_SAFE_INTEGER),
            v.check((n) => !Object.is(n, -0), "Ply cannot be negative zero")
          ),
        })
      ),
    })
  ),
});
/**
 * The structurally validated authored document IR before linking.
 */
export type DocumentData = v.InferOutput<typeof ModuleSchema>;
/**
 * An authored board occurrence referencing a game and a mainline anchor.
 */
export type SceneData = DocumentData["stories"][number]["scenes"][number];
/**
 * Validate external structured document data without throwing for invalid input.
 * @param input - Untrusted content to validate at this boundary.
 * @returns Validated authored data or a structural failure value.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is an external-data validation boundary; accepting unknown prevents callers from assuming validation already happened.
export const parseStructured = (input: unknown): Result<DocumentData> => {
  const parsed = v.safeParse(ModuleSchema, input);
  return parsed.success
    ? ok(parsed.output)
    : {
        error: {
          code: "document/invalid-shape",
          kind: "schema",
          message: "Invalid structured document.",
          paths: parsed.issues.map((issue) =>
            (issue.path ?? []).map((p) => String(p.key)).join(".")
          ),
        },
        ok: false,
      };
};

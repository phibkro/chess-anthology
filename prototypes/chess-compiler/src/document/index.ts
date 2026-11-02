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
  v.check((s) => !reserved.includes(s), "Reserved keyword")
);
const Note = v.variant("type", [
  v.strictObject({ type: v.literal("text"), text: v.string() }),
  v.strictObject({
    type: v.literal("arrow"),
    from: v.string(),
    to: v.string(),
    color: Identifier,
  }),
  v.strictObject({
    type: v.literal("prompt"),
    text: v.string(),
    answer: v.string(),
  }),
]);
const ModuleSchema = v.strictObject({
  formatVersion: v.literal(0),
  name: Identifier,
  imports: v.array(v.string()),
  games: v.array(
    v.strictObject({
      name: Identifier,
      exported: v.boolean(),
      source: v.string(),
    })
  ),
  stories: v.array(
    v.strictObject({
      name: Identifier,
      scenes: v.array(
        v.strictObject({
          name: Identifier,
          game: Identifier,
          ply: v.pipe(
            v.number(),
            v.integer(),
            v.minValue(0),
            v.maxValue(Number.MAX_SAFE_INTEGER),
            v.check((n) => !Object.is(n, -0), "Ply cannot be negative zero")
          ),
          notes: v.array(Note),
        })
      ),
    })
  ),
});
export type DocumentData = v.InferOutput<typeof ModuleSchema>;
export type SceneData = DocumentData["stories"][number]["scenes"][number];
export type Issue = {
  code: string;
  message: string;
  path: (string | number)[];
};
export type ReadonlyDeep<T> = T extends object
  ? { readonly [K in keyof T]: ReadonlyDeep<T[K]> }
  : T;
export type Failure = {
  kind:
    | "syntax"
    | "schema"
    | "io"
    | "chess"
    | "integrity"
    | "selection"
    | "infrastructure";
  code: string;
  message: string;
  paths?: readonly string[];
};
export type Result<T, E = Failure> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = (
  kind: Failure["kind"],
  code: string,
  message: string
): Result<never> => ({
  ok: false,
  error: { kind, code, message },
});
export function parseStructured(input: unknown): Result<DocumentData> {
  const parsed = v.safeParse(ModuleSchema, input);
  return parsed.success
    ? ok(parsed.output)
    : {
        ok: false,
        error: {
          kind: "schema",
          code: "document/invalid-shape",
          message: "Invalid structured document.",
          paths: parsed.issues.map((issue) =>
            (issue.path ?? []).map((p) => String(p.key)).join(".")
          ),
        },
      };
}

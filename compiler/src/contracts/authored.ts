// JSON authoring contracts, independent of Langium's mutable object graph.
import * as v from "valibot";

import { ok } from "./core.js";
import type { Result, ReadonlyDeep } from "./core.js";
import { markdownSchema } from "./markdown.js";

export const reservedIdentifiers = [
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
] as const;
const reserved = new Set<string>(reservedIdentifiers);
export const Identifier = v.pipe(
  v.string(),
  // oxlint-disable-next-line require-unicode-regexp -- JSON Schema patterns cannot carry flags; this pattern is ASCII-only.
  v.regex(/^[_a-zA-Z][_a-zA-Z0-9-]*$/),
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
const LegacySchema = v.strictObject({
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
/** Metadata shared by Markdown frontmatter and structured authoring. */
export const metadataSchema = v.strictObject({
  authors: v.optional(v.array(v.string())),
  title: v.optional(v.string()),
});
const memberReference = v.union([
  v.string(),
  v.strictObject({ as: Identifier, use: v.string() }),
]);
/** Frontmatter names reusable stories/collections separately from game bindings. */
export const frontmatterSchema = v.strictObject({
  ...metadataSchema.entries,
  collections: v.optional(v.record(Identifier, v.array(memberReference))),
  exports: v.optional(v.array(Identifier)),
  games: v.optional(v.record(Identifier, v.string())),
  id: Identifier,
  imports: v.optional(v.array(v.string())),
  uses: v.optional(v.record(Identifier, v.string())),
});
const richNote = v.variant("type", [
  ...Note.options,
  v.strictObject({ content: markdownSchema, type: v.literal("markdown") }),
]);
const markdownIdentifier = Identifier;
/** Version one adds metadata, display titles and CommonMark trees. */
export const authoringSchema = v.strictObject({
  formatVersion: v.literal(1),
  games: LegacySchema.entries.games,
  imports: LegacySchema.entries.imports,
  metadata: metadataSchema,
  name: Identifier,
  stories: v.array(
    v.strictObject({
      name: markdownIdentifier,
      scenes: v.array(
        v.strictObject({
          game: Identifier,
          name: markdownIdentifier,
          notes: v.array(richNote),
          ply: LegacySchema.entries.stories.item.entries.scenes.item.entries
            .ply,
          title: v.string(),
        })
      ),
      title: v.string(),
    })
  ),
});
const includeSchema = v.strictObject({
  name: Identifier,
  reference: v.string(),
  type: v.literal("include"),
});
/** Composition is authored references; linking never rewrites these definitions. */
export const compositionSchema = v.strictObject({
  ...authoringSchema.entries,
  collections: v.array(
    v.strictObject({
      members: v.array(
        v.strictObject({ name: Identifier, reference: v.string() })
      ),
      name: Identifier,
    })
  ),
  exports: v.array(Identifier),
  formatVersion: v.literal(2),
  stories: v.array(
    v.strictObject({
      ...authoringSchema.entries.stories.item.entries,
      scenes: v.array(
        v.union([
          authoringSchema.entries.stories.item.entries.scenes.item,
          includeSchema,
        ])
      ),
    })
  ),
  uses: v.array(v.strictObject({ name: Identifier, source: v.string() })),
});
/** An authoring module with reusable story/collection references. */
export type CompositionData = v.InferOutput<typeof compositionSchema>;
/** Both supported Markdown AST versions. */
export type MarkdownData =
  | v.InferOutput<typeof authoringSchema>
  | CompositionData;
/** A reference occurrence inside a composed story. */
type StoryInclude = v.InferOutput<typeof includeSchema>;
const ModuleSchema = v.variant("formatVersion", [
  LegacySchema,
  authoringSchema,
  compositionSchema,
]);
/** Markdown's typed, JSON-serializable authoring AST. */
export type AuthoringData = v.InferOutput<typeof authoringSchema>;
/**
 * The structurally validated authored document IR before linking.
 */
export type DocumentData = v.InferOutput<typeof ModuleSchema>;
/**
 * An authored board occurrence referencing a game and a mainline anchor.
 */
export type SceneData = Exclude<
  DocumentData["stories"][number]["scenes"][number],
  StoryInclude
>;
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

/** Narrative modules referenced by authored imports and named composition bindings.
 * @param data - Validated authored module.
 * @returns Dependency paths without story selectors.
 */
export const narrativeDependencies = (
  data: ReadonlyDeep<DocumentData>
): string[] => [
  ...data.imports,
  ...(data.formatVersion === 2
    ? data.uses.map((binding) => binding.source.split("#")[0])
    : []),
];
/** All acquired dependencies, retaining PGN record selectors.
 * @param data - Validated authored module.
 * @returns Narrative and game source dependencies.
 */
export const sourceDependencies = (
  data: ReadonlyDeep<DocumentData>
): string[] => [
  ...narrativeDependencies(data),
  ...data.games.map((game) => game.source),
];

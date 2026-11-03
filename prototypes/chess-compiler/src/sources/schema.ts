import * as v from "valibot";

const providerId = v.pipe(v.string(), v.regex(/^[a-z][a-z0-9-]*$/u));
const provider = v.variant("kind", [
  v.strictObject({
    id: providerId,
    kind: v.literal("directory"),
    path: v.string(),
  }),
  v.strictObject({ id: providerId, kind: v.literal("http"), url: v.string() }),
]);
export const configSchema = v.strictObject({
  providers: v.array(provider),
  version: v.literal(1),
});
/** Configured source providers in discovery order. */
export type SourceConfig = v.InferOutput<typeof configSchema>;
const blobSchema = v.pipe(v.string(), v.regex(/^sha256:[a-f0-9]{64}$/u));
export const resolutionSchema = v.strictObject({
  blob: blobSchema,
  original: blobSchema,
  selection: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
  source: v.string(),
});
/** An external record and its exact acquired and selected blobs. */
export type Resolution = v.InferOutput<typeof resolutionSchema>;
export const lockSchema = v.strictObject({
  config: blobSchema,
  imports: v.record(v.string(), resolutionSchema),
  version: v.literal(1),
});
/** Project external resolutions bound to provider configuration. */
export type SourceLock = v.InferOutput<typeof lockSchema>;
export const manifestSchema = v.strictObject({
  inputs: v.record(v.string(), blobSchema),
  resolutions: lockSchema,
  version: v.literal(1),
});
/** Exact inputs of a published edition. */
export type SourceManifest = v.InferOutput<typeof manifestSchema>;

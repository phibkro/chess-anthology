/* oxlint-disable no-await-in-loop -- Traverse imports in stable order and deduplicate cycles before acquisition. */
import * as v from "valibot";

import type { CompilerOptions } from "../compiler/index.js";
import { createCompiler, decode } from "../compiler/index.js";
import { ok, err } from "../contracts/index.js";
import { isNarrative } from "../runtime/narrative.js";
import { decodeSourceText } from "../runtime/source-text.js";
import { openResolver } from "./resolver.js";
import type { ResolverOptions } from "./resolver.js";
import { manifestSchema } from "./schema.js";
import type { SourceManifest } from "./schema.js";
import { writeAtomic } from "./storage.js";

export { openResolver, isBareReference } from "./resolver.js";
export type { ResolverOptions } from "./resolver.js";
export type { SourceConfig, SourceLock, SourceManifest } from "./schema.js";

/** Project acquisition and reproducible-publication controls. */
export interface ProjectOptions extends ResolverOptions {
  entries?: string[];
  writeManifest?: boolean;
}

/**
 * Resolve the transitive source closure before invoking the pure compiler.
 * @param options - Source roots, acquisition policy and publication controls.
 * @returns Acquired source text or an acquisition failure.
 */
const createProjectLoader = () => {
  const dependencies = new Map<string, { source: string; paths: string[] }>();
  return async (options: ProjectOptions) => {
    let parsedNarratives = 0;
    const visited = new Set<string>();
    try {
      if (options.mode === "frozen" && options.writeManifest === true) {
        throw new Error(
          "source/frozen-write: A frozen build cannot write an edition manifest."
        );
      }
      const resolver = await openResolver(options);
      const sources = new Map<string, string>();
      const inputs: Record<string, string> = {};
      const visit = async (uri: string, reference?: string): Promise<void> => {
        // Every reference must satisfy its own acquisition policy, even when URIs coincide.
        const bytes = await resolver.read(uri, reference);
        if (visited.has(uri)) {
          return;
        }
        visited.add(uri);
        const text = decodeSourceText(bytes);
        sources.set(uri, text);
        inputs[resolver.portable(uri)] = await resolver.blobs.put(bytes);
        if (isNarrative(uri)) {
          let cached = dependencies.get(uri);
          if (cached?.source !== text) {
            const parsed = decode(text);
            parsedNarratives += 1;
            cached = {
              paths: parsed.ok
                ? [
                    ...parsed.value.imports,
                    ...parsed.value.games.map((game) => game.source),
                  ]
                : [],
              source: text,
            };
            dependencies.set(uri, cached);
          }
          for (const path of cached.paths) {
            await visit(new URL(path, uri).href, path);
          }
        }
      };
      const entries =
        options.entries ??
        [
          ...new Bun.Glob("*.{chess-story,chess.md,pgn}").scanSync({
            cwd: Bun.fileURLToPath(options.root),
            dot: true,
            onlyFiles: true,
          }),
        ].toSorted();
      for (const path of entries) {
        await visit(new URL(path, options.root).href);
      }
      const manifest: SourceManifest = {
        inputs: Object.fromEntries(
          Object.entries(inputs).toSorted(([a], [b]) => a.localeCompare(b))
        ),
        resolutions: resolver.describe(),
        version: 1,
      };
      const manifestURL = new URL("chess.edition.json", options.root);
      if (options.mode === "frozen") {
        const file = Bun.file(manifestURL);
        if (!(await file.exists())) {
          throw new Error(
            "source/missing-manifest: Create an edition with --write-manifest first."
          );
        }
        const recorded = v.parse(manifestSchema, await file.json());
        if (
          JSON.stringify(recorded.resolutions) !==
            JSON.stringify(manifest.resolutions) ||
          Object.keys(recorded.inputs).length !== Object.keys(inputs).length ||
          Object.entries(recorded.inputs).some(
            ([key, id]) => inputs[key] !== id
          )
        ) {
          throw new Error(
            "source/edition-changed: Current inputs differ from chess.edition.json."
          );
        }
      }
      // Adapters commit metadata only after a successful compiler update.
      const finish = async (): Promise<void> => {
        await resolver.finish();
        if (options.writeManifest === true) {
          if (options.mode === "frozen") {
            throw new Error(
              "source/frozen-write: A frozen build cannot write an edition manifest."
            );
          }
          await writeAtomic(
            manifestURL,
            `${JSON.stringify(manifest, null, 2)}\n`
          );
        }
      };
      return ok({
        acquisition: { parsedNarratives },
        changes: resolver.changes,
        finish,
        manifest,
        sources,
      });
    } catch (error) {
      const message = String(error);
      return err(
        "io",
        /source\/[a-z-]+/u.exec(message)?.[0] ?? "source/acquisition-failed",
        message
      );
    } finally {
      for (const uri of dependencies.keys()) {
        if (!visited.has(uri)) {
          dependencies.delete(uri);
        }
      }
    }
  };
};

/**
 * Acquire one project without retaining discovery state between calls.
 * @param options - Project and resolution controls.
 * @returns Resolved sources and acquisition counters or a boundary failure.
 */
export const loadProjectSources = async (options: ProjectOptions) =>
  await createProjectLoader()(options);

/**
 * Keep incremental state while reopening persistent resolutions per update.
 * @param compilerOptions - Replay retention budgets.
 * @returns A project compiler with persistent source acquisition.
 */
export const createProjectCompiler = (
  compilerOptions: CompilerOptions = {}
) => {
  const compiler = createCompiler(compilerOptions);
  const loadSources = createProjectLoader();
  let busy = false;
  return {
    update: async (options: ProjectOptions) => {
      if (busy) {
        return err(
          "infrastructure",
          "build/busy",
          "Await the current project update before starting another."
        );
      }
      busy = true;
      try {
        const loaded = await loadSources(options);
        if (!loaded.ok) {
          return loaded;
        }
        const built = await compiler.update(loaded.value.sources);
        if (!built.ok) {
          return built;
        }
        try {
          await loaded.value.finish();
          return ok({
            ...built.value,
            acquisition: loaded.value.acquisition,
            changes: loaded.value.changes,
            manifest: loaded.value.manifest,
          });
        } catch (error) {
          return err("io", "source/write-failed", String(error));
        }
      } finally {
        busy = false;
      }
    },
  };
};

export { parseSourceConfig, editSourceConfig } from "./config.js";

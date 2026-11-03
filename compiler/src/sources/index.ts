/* oxlint-disable no-await-in-loop -- Traverse imports in stable order and deduplicate cycles before acquisition. */
import * as v from "valibot";

import { createCompiler, decode } from "../compiler/index.js";
import { ok, err } from "../contracts/index.js";
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
export const loadProjectSources = async (options: ProjectOptions) => {
  try {
    if (options.mode === "frozen" && options.writeManifest === true) {
      throw new Error(
        "source/frozen-write: A frozen build cannot write an edition manifest."
      );
    }
    const resolver = await openResolver(options);
    const sources = new Map<string, string>();
    const inputs: Record<string, string> = {};
    const visited = new Set<string>();
    const visit = async (uri: string, reference?: string): Promise<void> => {
      // Every reference must satisfy its own acquisition policy, even when URIs coincide.
      const bytes = await resolver.read(uri, reference);
      if (visited.has(uri)) {
        return;
      }
      visited.add(uri);
      sources.set(uri, decodeSourceText(bytes));
      inputs[resolver.portable(uri)] = await resolver.blobs.put(bytes);
      if (new URL(uri).pathname.endsWith(".chess-story")) {
        const parsed = decode(decodeSourceText(bytes));
        if (parsed.ok) {
          for (const path of [
            ...parsed.value.imports,
            ...parsed.value.games.map((game) => game.source),
          ]) {
            await visit(new URL(path, uri).href, path);
          }
        }
      }
    };
    const entries =
      options.entries ??
      [
        ...new Bun.Glob("*.{chess-story,pgn}").scanSync({
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
        Object.entries(recorded.inputs).some(([key, id]) => inputs[key] !== id)
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
    return ok({ changes: resolver.changes, finish, manifest, sources });
  } catch (error) {
    const message = String(error);
    return err(
      "io",
      /source\/[a-z-]+/u.exec(message)?.[0] ?? "source/acquisition-failed",
      message
    );
  }
};

/**
 * Keep incremental state while reopening persistent resolutions per update.
 * @returns A project compiler with persistent source acquisition.
 */
export const createProjectCompiler = () => {
  const compiler = createCompiler();
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
        const loaded = await loadProjectSources(options);
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

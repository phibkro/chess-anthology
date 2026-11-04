import { URI } from "langium";

import { ok, err } from "../../contracts/index.js";
import type {
  Result,
  BuildSnapshot,
  BuildUpdate,
  CompilerOptions,
} from "../../contracts/index.js";
import { isNarrative } from "../../runtime/narrative.js";
import { createWorkspace, relative } from "../300-linking/index.js";
import type { Sources } from "../300-linking/index.js";
import { createChessAnalysis } from "../400-chess-analysis/index.js";
import { emitDocument } from "../500-emission/index.js";
import type { EmittedDocument } from "../500-emission/index.js";
import { freeze } from "../identity.js";

export type { BuildSnapshot, CompilerOptions } from "../../contracts/index.js";

/**
 * Create an incremental compiler whose updates preserve earlier snapshots.
 * @param options - Optional inactive replay-cache budgets.
 * @returns An incremental compiler with owned source revisions and cache statistics.
 */
export const createCompiler = (options: CompilerOptions = {}) => {
  const analysis = createChessAnalysis(options.cache);
  const workspace = createWorkspace(analysis);
  const outputs = new Map<string, EmittedDocument>();
  let orderedUris: string[] = [];
  const outputAt = (uri: string) => {
    const document = outputs.get(uri);
    if (document === undefined) {
      throw new Error("Missing indexed output.");
    }
    return document;
  };
  let snapshot: BuildSnapshot = freeze({
    games: [],
    output: [],
    parentRevision: null,
    revision: 0,
  });
  let busy = false;
  let failed = false;
  const update = async (
    sources: ReadonlyMap<string, string>
  ): Promise<Result<BuildUpdate>> => {
    if (failed) {
      return err(
        "infrastructure",
        "build/recreate-required",
        "Create a new compiler after an infrastructure failure; the previous snapshot remains valid."
      );
    }
    if (busy) {
      return err(
        "infrastructure",
        "build/busy",
        "Await the current update before starting another."
      );
    }
    busy = true;
    try {
      const before = analysis.replayCount;
      const revision = new Map(sources);
      analysis.setActiveSources(
        [...revision]
          .filter(([uri]) => !isNarrative(uri))
          .map(([, text]) => text)
      );
      const changes = await workspace.update(revision);
      if (!changes.changed.length && !changes.deleted.length) {
        return ok({ snapshot, work: { emitted: 0, parsed: 0, replayed: 0 } });
      }
      let orderChanged = false;
      for (const uri of changes.deleted) {
        if (outputs.delete(uri)) {
          orderChanged = true;
        }
      }
      for (const uri of changes.validated) {
        const document = workspace.documents.getDocument(URI.parse(uri));
        if (document) {
          if (!outputs.has(uri)) {
            orderChanged = true;
          }
          outputs.set(uri, emitDocument(document, workspace.sources, analysis));
        }
      }
      const referenced = new Set(
        [...outputs.values()].flatMap((document) =>
          (document.data?.games ?? []).map((game) =>
            relative(document.uri, game.source)
          )
        )
      );
      const games = [...revision]
        .filter(([uri]) => uri.endsWith(".pgn") || referenced.has(uri))
        .map(([uri, source]) => {
          const replayed = analysis.replay(source);
          return {
            result: replayed.ok ? ok(replayed.value.history) : replayed,
            uri,
          };
        });
      if (orderChanged) {
        orderedUris = [...outputs.keys()].toSorted((a, b) =>
          a.localeCompare(b)
        );
      }
      snapshot = freeze({
        games,
        output: orderedUris.map(outputAt),
        parentRevision: snapshot.revision,
        revision: snapshot.revision + 1,
      });
      return ok({
        snapshot,
        work: {
          emitted: changes.validated.length,
          parsed: changes.parsed,
          replayed: analysis.replayCount - before,
        },
      });
    } catch (error) {
      failed = true;
      return err("infrastructure", "build/failure", String(error));
    } finally {
      busy = false;
    }
  };
  return { cacheStats: analysis.stats, update };
};
/**
 * Compile a complete source map with a fresh compiler.
 * @param sources - Source text keyed by its canonical URI.
 * @returns The resulting snapshot or an infrastructure diagnostic.
 */
export const compile = async (
  sources: Sources
): Promise<Result<BuildSnapshot>> => {
  const built = await createCompiler().update(sources);
  return built.ok ? ok(built.value.snapshot) : built;
};
/**
 * Select a historical board position without changing the snapshot.
 * @param snapshot - The immutable revision to read.
 * @param gameUri - A game source URI present in that revision.
 * @param ply - A zero-based half-move index, including the initial position.
 * @returns The frame or a diagnostic for an unavailable game or position.
 */
export const selectPosition = (
  snapshot: BuildSnapshot,
  gameUri: string,
  ply: number
) => {
  if (!Number.isSafeInteger(ply) || ply < 0) {
    return err(
      "selection",
      "view/invalid-ply",
      "Ply must be a nonnegative safe integer."
    );
  }
  const game = snapshot.games.find((entry) => entry.uri === gameUri);
  if (!game) {
    return err(
      "selection",
      "view/missing-game",
      "Game is unavailable in this snapshot."
    );
  }
  if (!game.result.ok) {
    return game.result;
  }
  const frame = game.result.value.frames.at(ply);
  return frame
    ? ok(frame)
    : err(
        "selection",
        "view/missing-position",
        "Position is unavailable in this history."
      );
};

import { URI } from "langium";

import { ok, err } from "../../contracts/index.js";
import type {
  Result,
  BuildSnapshot,
  BuildUpdate,
} from "../../contracts/index.js";
import { createWorkspace, relative } from "../300-linking/index.js";
import type { Sources } from "../300-linking/index.js";
import { createChessAnalysis } from "../400-chess-analysis/index.js";
import { emitDocument } from "../500-emission/index.js";
import type { EmittedDocument } from "../500-emission/index.js";
import { freeze } from "../identity.js";

export type { BuildSnapshot } from "../../contracts/index.js";

/**
 * Create an incremental compiler whose updates preserve earlier snapshots.
 * @returns A compiler accepting complete source maps, with expected failures returned as values.
 */
export const createCompiler = () => {
  const analysis = createChessAnalysis();
  const workspace = createWorkspace(analysis);
  const outputs = new Map<string, EmittedDocument>();
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
      const changes = await workspace.update(new Map(sources));
      if (!changes.changed.length && !changes.deleted.length) {
        return ok({ snapshot, work: { emitted: 0, parsed: 0, replayed: 0 } });
      }
      for (const uri of changes.deleted) {
        outputs.delete(uri);
      }
      for (const uri of changes.validated) {
        const document = workspace.documents.getDocument(URI.parse(uri));
        if (document) {
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
      const games = [...sources]
        .filter(([uri]) => uri.endsWith(".pgn") || referenced.has(uri))
        .map(([uri, source]) => {
          const replayed = analysis.replay(source);
          return {
            result: replayed.ok ? ok(replayed.value.history) : replayed,
            uri,
          };
        });
      snapshot = freeze({
        games,
        output: [...outputs.values()].toSorted((a, b) =>
          a.uri.localeCompare(b.uri)
        ),
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
  return { update };
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

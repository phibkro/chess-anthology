import { URI } from "langium";
import { createWorkspace, type Sources } from "../300-linking/index.js";
import { createChessAnalysis, type GameHistory } from "../400-chess-analysis/index.js";
import { emitDocument, type EmittedDocument } from "../500-emission/index.js";
import { freeze } from "../identity.js";
import { ok, err, type ReadonlyDeep, type Result } from "../../document/index.js";

export type BuildSnapshot = {
  readonly revision: number;
  readonly parentRevision: number | null;
  readonly output: readonly ReadonlyDeep<EmittedDocument>[];
  readonly games: readonly { readonly uri: string; readonly result: Result<GameHistory> }[];
};
export function createCompiler() {
  const analysis = createChessAnalysis();
  const workspace = createWorkspace(analysis);
  const outputs = new Map<string, EmittedDocument>();
  let snapshot: BuildSnapshot = freeze({
    revision: 0,
    parentRevision: null,
    output: [],
    games: [],
  });
  let busy = false;
  let failed = false;
  async function update(
    sources: ReadonlyMap<string, string>,
  ): Promise<
    Result<{ snapshot: BuildSnapshot; work: { parsed: number; replayed: number; emitted: number } }>
  > {
    if (failed)
      return err(
        "infrastructure",
        "build/recreate-required",
        "Create a new compiler after an infrastructure failure; the previous snapshot remains valid.",
      );
    if (busy)
      return err(
        "infrastructure",
        "build/busy",
        "Await the current update before starting another.",
      );
    busy = true;
    try {
      const before = analysis.replayCount;
      const changes = await workspace.update(new Map(sources));
      if (!changes.changed.length && !changes.deleted.length)
        return ok({ snapshot, work: { parsed: 0, replayed: 0, emitted: 0 } });
      for (const uri of changes.deleted) outputs.delete(uri);
      for (const uri of changes.validated) {
        const document = workspace.documents.getDocument(URI.parse(uri));
        if (document) outputs.set(uri, emitDocument(document, workspace.sources, analysis));
      }
      const games = [...sources]
        .filter(([uri]) => uri.endsWith(".pgn"))
        .map(([uri, source]) => {
          const replayed = analysis.replay(source);
          return { uri, result: replayed.ok ? ok(replayed.value.history) : replayed };
        });
      snapshot = freeze({
        revision: snapshot.revision + 1,
        parentRevision: snapshot.revision,
        output: [...outputs.values()].sort((a, b) => a.uri.localeCompare(b.uri)),
        games,
      });
      return ok({
        snapshot,
        work: {
          parsed: changes.parsed,
          replayed: analysis.replayCount - before,
          emitted: changes.validated.length,
        },
      });
    } catch (error) {
      failed = true;
      return err("infrastructure", "build/failure", String(error));
    } finally {
      busy = false;
    }
  }
  return { update };
}
export async function compile(sources: Sources): Promise<Result<BuildSnapshot>> {
  const built = await createCompiler().update(sources);
  return built.ok ? ok(built.value.snapshot) : built;
}
export function selectPosition(snapshot: BuildSnapshot, gameUri: string, ply: number) {
  if (!Number.isSafeInteger(ply) || ply < 0)
    return err("selection", "view/invalid-ply", "Ply must be a nonnegative safe integer.");
  const game = snapshot.games.find((game) => game.uri === gameUri);
  if (!game) return err("selection", "view/missing-game", "Game is unavailable in this snapshot.");
  if (!game.result.ok) return game.result;
  const frame = game.result.value.frames[ply];
  return frame
    ? ok(frame)
    : err("selection", "view/missing-position", "Position is unavailable in this history.");
}

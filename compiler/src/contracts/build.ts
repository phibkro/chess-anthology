import type { ReadonlyDeep, Result } from "./core.js";
import type { EmittedDocument } from "./emission.js";
import type { GameHistory } from "./history.js";

/** Complete source text indexed by canonical URI, copied by the workspace on update. */
export type Sources = Map<string, string>;

/** An immutable revision of emitted documents and recorded game histories. */
export interface BuildSnapshot {
  readonly games: readonly {
    readonly result: Result<GameHistory>;
    readonly uri: string;
  }[];
  readonly output: readonly ReadonlyDeep<EmittedDocument>[];
  readonly parentRevision: number | null;
  readonly revision: number;
}

/** Deterministic phase work, distinct from elapsed time or source scanning cost. */
export interface BuildWork {
  emitted: number;
  parsed: number;
  replayed: number;
}

/** A completed update; successful execution does not imply publishable content. */
export interface BuildUpdate {
  snapshot: BuildSnapshot;
  work: BuildWork;
}

/** Budgets for inactive replay state; active game histories are not evicted. */
export interface ReplayCachePolicy {
  maxInactiveEntries?: number;
  maxInactivePositions?: number;
  maxInactiveSourceBytes?: number;
}
/** Compiler-owned replay retention controls. */
export interface CompilerOptions {
  cache?: ReplayCachePolicy;
}

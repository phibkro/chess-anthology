/** Immutable recorded mainline positions, with the initial frame at index zero. */
export interface GameHistory {
  readonly sourceDigest: string;
  readonly frames: readonly {
    readonly fen: string;
    readonly san: string | null;
    readonly uci: string | null;
  }[];
}

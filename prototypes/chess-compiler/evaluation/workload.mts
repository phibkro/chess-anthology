import type { BuildWork } from "../src/contracts/index.js";
import type { Scenario } from "./report-contract.mjs";

/**
 * Construct a deterministic shared-game workload without filesystem acquisition.
 * @param stories - Number of importing story documents, at least one.
 * @returns Complete source text indexed by stable fixture URIs.
 */
export const createWorkload = (stories: number): Map<string, string> => {
  if (!Number.isSafeInteger(stories) || stories < 1) {
    throw new RangeError("Story count must be a positive safe integer.");
  }
  const sources = new Map([
    [
      "file:///evaluation/game.pgn",
      '[Event "Baseline"]\n\n1. e4 e5 2. Nf3 Nc6 *',
    ],
    [
      "file:///evaluation/library.chess-story",
      'module library; export game opening from "./game.pgn";',
    ],
  ]);
  for (let i = 0; i < stories; i += 1) {
    sources.set(
      `file:///evaluation/story-${i}.chess-story`,
      `module story${i}; import "./library.chess-story"; story openingStory { board first game opening after 1 { text "Original prose."; } }`
    );
  }
  return sources;
};

/**
 * Create an edited complete source map; the baseline map is never changed.
 * @param sources - Baseline workload.
 * @param scenario - The single change being measured.
 * @param revision - Unique content identity, preventing accidental replay-cache hits.
 * @returns Sources for the selected update.
 */
export const editWorkload = (
  sources: ReadonlyMap<string, string>,
  scenario: "prose" | "shared-game" | "unchanged",
  revision: number
): Map<string, string> => {
  const next = new Map(sources);
  if (scenario === "prose") {
    const uri = "file:///evaluation/story-0.chess-story";
    next.set(
      uri,
      (sources.get(uri) ?? "").replace(
        "Original prose.",
        `Revised prose ${revision}.`
      )
    );
  }
  if (scenario === "shared-game") {
    const uri = "file:///evaluation/game.pgn";
    next.set(
      uri,
      (sources.get(uri) ?? "").replace("Baseline", `Revision ${revision}`)
    );
  }
  return next;
};

/**
 * Specify the independent phase-work budget for a shared-game fixture.
 * @param stories - Number of importing story documents.
 * @param scenario - Operation under evaluation.
 * @returns Expected phase counters, independent of compiler implementation.
 */
export const expectedWork = (stories: number, scenario: Scenario): BuildWork =>
  ({
    initial: { emitted: stories + 1, parsed: stories + 1, replayed: 1 },
    prose: { emitted: 1, parsed: 1, replayed: 0 },
    "shared-game": { emitted: stories + 1, parsed: 0, replayed: 1 },
    unchanged: { emitted: 0, parsed: 0, replayed: 0 },
  })[scenario];

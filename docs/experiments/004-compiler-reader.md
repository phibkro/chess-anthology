# Compiler package → multi-game reader

This slice consumes the compiler through the package export `chess-compiler-prototype`, before merging the compiler branch. It does not import the compiler's internal files into the app.

## Data path

1. `scripts/compile-stories.mts` loads the two narrative modules and historical PGNs from the experiment examples.
2. The compiler builds a snapshot, then its `createPlaybackPlan` target emits portable data for `matingNets`.
3. The generated `src/content/generated/queen-offers.json` contains ordered boards, mainline position frames, move notation, prose, arrows and resolved prompt moves. It contains no local filesystem URIs or Langium objects.
4. The web reader validates this data through the browser-safe `chess-compiler-prototype/playback` export and uses its own XState Store session for navigation and temporary tries.

The root uses a linked package dependency; install both the root and the existing isolated compiler package on a fresh checkout. `pnpm compile:stories` regenerates the content; dev startup and production builds invoke it. Editing source while dev is running requires running that command again. Generated JSON is committed, and an integration test compares it with fresh package output so stale artifacts fail verification.

## Playback target contract

The compiler's authored format remains version 0; the playback plan is a distinct version-1 target contract. It uses logical scene/game names and content digests rather than machine-specific source paths. Every frame records its FEN and incoming SAN/UCI move.

This target supports mainline replay with one optional prompt per board. It explicitly rejects a legal prompt answer that does not follow the recorded continuation, rather than silently replacing that answer or inventing a response. A general compiler-valid narrative may therefore be unsupported by this playback target.

Prose, prompts and arrows come from authored source. Product titles and source credits are editorial presentation metadata keyed by game alias. The reader shares the existing Chessground board adapter. Arrows appear on reveal or immediately after a correct move, and are hidden while a temporary try is shown.

## Verified behavior

- The Opera Game opens after `15...Nxd7`, Réti–Tartakower after `8...Nxe4`.
- Desktop pointer drags successfully play `Qb8+` and `Qd8+` in their respective games.
- `Qa3` stays visible as a legal alternative, with neutral retry feedback and continuation paused.
- Example navigation resets temporary state and selects the other game's history without mutating source data.
- The authored b3–b8 arrow renders on reveal; the selected answer is displayed.
- Four integration/session tests exercise the package-to-reader path, portable reproducible output, tries, scene changes and unsupported target behavior.
- Root checks pass with 33 tests, plus the compiler's nine seam/property/fuzz tests. The production browser bundle has no Langium/Chevrotain or Node filesystem code.

## Still open

Browser-side compilation, a visual/text authoring editor, variation playback, richer feedback/hints in the compiler language and source-preserving edits remain separate work. Mobile/touch QA and independent editorial review remain outstanding. This is a review deployment from the compiler branch, not a merge into main.

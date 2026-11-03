# Chess Anthology compiler

The supported Bun compiler module for Chess Anthology. The application build uses its public API to produce portable playback plans; the browser imports only the playback contract. Langium, chessops analysis and source acquisition stay in build/editor tooling.

Package: `@chess-anthology/compiler`, private to this repository. Runtime: Bun 1.4.4; dependency management: pnpm 12.16.1.

## Run

Install from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --dir compiler install --frozen-lockfile
pnpm --dir compiler demo
pnpm --dir compiler compile examples
pnpm --dir compiler check
pnpm --dir compiler test
pnpm --dir compiler eval
```

The CLI accepts a source directory, follows narrative imports and game dependencies, and exits nonzero on acquisition failures or error diagnostics. [Source resolution](../docs/compiler-sources.md) describes directory/HTTP providers, content-addressed storage, locks and publication manifests.

```sh
pnpm --dir compiler compile /path/to/project --update-sources
pnpm --dir compiler compile /path/to/project --write-manifest
pnpm --dir compiler compile /path/to/project --frozen --offline
```

## Public interfaces

| Import | Purpose |
| --- | --- |
| `@chess-anthology/compiler` | Compile/update source maps; codecs, immutable snapshots, position selection and playback emission |
| `@chess-anthology/compiler/sources` | Project source acquisition, incremental project builds and persistent resolution |
| `@chess-anthology/compiler/playback` | Browser-safe playback schema and types |

Implementation directories and numbered phases are private. See [module boundaries](../MODULES.md) and [evaluations](../docs/compiler-evaluations.md).

## Editor and parser

Launch `bun /absolute/path/to/compiler/src/adapters/lsp.ts --stdio` or `pnpm --dir compiler lsp`. Use language ID `chess-narrative` and extension `.chess-story`. The first workspace folder supplies the source root; `CHESS_SOURCE_ROOT` overrides it. Stdout is reserved for LSP frames.

The server shares linking and chess validation, reports ranged/versioned diagnostics, offers legal SAN completion and imported-game definitions, and handles PGN watches and unsaved buffers. Configuration changes require a restart. See [LSP verification](../docs/compiler-lsp-evaluations.md).

After grammar changes, run `pnpm --dir compiler generate` and commit the regenerated parser. `FC_SEED=8128 pnpm --dir compiler test` reproduces an alternate property-test seed.

## Authoring example

```text
module queenOffers;
import "./library.chess-story";
story matingNets {
  board operaFinish game opera after 30 {
    text "The queen opens a path to the back rank.";
    prompt "Find the forcing move." answer "Qb8+";
  }
}
```

The library declares `export game opera from "./opera.pgn";`. Explicit imports govern symbol visibility. `after` counts plies from the PGN starting position; standard chess and Chess960 are supported. Recorded branches are validated, while playback anchors currently expose the mainline.

## Current limits

Canonical printing normalizes authored layout. Exact untouched text is preserved in source envelopes, but semantic edits do not preserve surrounding trivia. PGN parsing is permissive and does not report every ignored token. Legal answers are checked for legality; this does not establish best play or historical correctness. Exports, re-exports and aliases beyond the documented grammar, semantic game deduplication, persistent engine-position caches and browser compiler packaging remain open.

The original [prototype results](RESULTS.md) are historical evidence. The alternative Go compiler and its LSP remain on [experimental/go-compiler](https://github.com/phibkro/chess-anthology/tree/experimental/go-compiler/prototypes/chess-compiler-go), outside the supported module and default CI. Optional cross-language experiments accept that branch's module through `CHESS_GO_MODULE` or `lsp_compare.py --go-module`.

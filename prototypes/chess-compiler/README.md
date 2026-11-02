# Chess compiler — Langium prototype

Disposable experiment on branch `prototype/langium-chess-compiler`. This is an executable language-tooling investigation, not the production lesson format. No frontend dependencies or reader behavior change.

## Run

From this directory, with Node 24 and pnpm 12.16.1:

```sh
pnpm install --frozen-lockfile
pnpm demo
pnpm compile examples
pnpm check
```

`demo` prints the structured documents, resolved board positions and diagnostic scenarios. `compile` accepts a directory of immediate `.chess-story` and `.pgn` files and exits nonzero on errors. Everything is local; no database credentials or external service is required.

To regenerate the committed parser after grammar changes:

```sh
pnpm generate
```

Start the language server with `pnpm lsp`, or configure an editor's LSP client to launch `node --import tsx /absolute/path/to/src/lsp.ts --stdio` with this directory as its working directory. Use language ID `chess-narrative`, extension `.chess-story`, and open `examples` as the workspace. The package script writes no application logs to stdout; stdout is reserved for LSP frames.

## Small source example

```text
module queenOffers;
import "./library.chess-story";
story matingNets {
  board operaFinish game opera after 30 {
    text "The queen opens a path to the back rank.";
    arrow "b3" -> "b8" green;
    prompt "Find the forcing move." answer "Qb8+";
  }
}
```

The library declares `export game opera from "./opera.pgn";`. Imports restrict visibility; merely loading another file does not expose its private games. The example story compares the Opera Game and Réti–Tartakower. `after` counts plies from the imported game's starting position, including custom PGN FEN starts; only mainline anchors are exposed by this grammar.

## What the experiment implements

- Langium-generated grammar/parser and workspace linking with explicit module imports and exported game symbols.
- Plain Valibot-validated structured data with no Langium references, containers or CST objects.
- Lexical, syntax, reference, annotation and chess diagnostics, with codes and LSP source ranges. Syntax errors stop semantic analysis for that document.
- Legal replay through chessops, including legality checks on parsed variations; selected positions become FEN plus legal SAN/UCI suggestions.
- Shared scene validation for flat and structured data: unavailable anchors, illegal answers and invalid arrows.
- Source envelopes preserving original text and rejecting mismatches against structured data; canonical structured-to-flat printing.
- A stdio LSP server sharing semantic validation, plus contextual legal-move completion inside prompt answers. Langium also provides game-reference completion and navigation.
- Conservative whole-workspace recompilation in the library adapter, so changed modules/assets cannot leave stale positions. The LSP uses Langium's document lifecycle.

## Boundaries deliberately left open

This is not the final isomorphic codec. Exact original text is retained in the envelope; there is no editor that preserves trivia around semantic edits. Canonical printing normalizes layout. Invalid drafts retain source but do not produce validated structured data. Names must be non-keyword ASCII identifiers.

The grammar covers exported games, not exported stories, re-exports, aliases or transitive imports. Ambiguous imports, duplicate declarations and import cycles are rejected. There is no database, EPD adapter, projection loss-report API, branch-path anchor, interactive reader or custom gamebook behavior interpreter yet. A legal answer is checked for legality, not correctness, best play or membership in the historical score.

chessops PGN parsing is permissive. We preserve source PGN and hash it for provenance, but do not yet detect every ignored token; this is not a lossless foreign-PGN importer. Illegal recorded moves are reported at the importing declaration, not inside the PGN. The Node compilation host uses Node hashing APIs; browser packaging has not been demonstrated.

The CLI requires all narrative modules in the supplied directory. The LSP loads narrative files in its workspace and reads PGN through a Node adapter; edits to PGN files alone do not yet trigger revalidation. Reopen/change a narrative document after changing its PGN dependency. Database fetching and watch integration are separate follow-up experiments.

See [RESULTS.md](RESULTS.md) for observed outcomes and [the architecture decision](../../docs/adr/0001-chess-compiler.md).

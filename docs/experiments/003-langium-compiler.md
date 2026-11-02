# Langium chess compiler prototype

Question: can a TypeScript/Langium frontend support modular chess narratives, reusable semantic diagnostics and source-preserving authoring without leaking framework objects into the public document?

The disposable implementation lives on branch `prototype/langium-chess-compiler`, under `prototypes/chess-compiler`. The production reader and its single-artifact version 1 format remain unchanged. The branch README supplies install, demo and language-server commands.

The experiment targets two source modules, a local PGN import, move-anchored prose, arrows and prompts. It must show separate lexical/parsing/linking/chess diagnostics, legal-move suggestions, plain structured output and exact unmodified source reproduction. Its LSP entrypoint should reuse the same semantic checks. Editing must invalidate dependents rather than returning stale validation.

A source-preserving envelope that simply retains original text proves untouched reproduction only. It does not prove a bidirectional editor, semantic edits with trivia preservation or the full isomorphic codec. Foreign notation also needs its own source preservation and explicit normalization reporting.

Langium adoption is provisional. The prototype must state what it demonstrates and what remains unsupported, especially database/EPD adapters, branching selectors, arbitrary extensions and loss-reporting exports. Do not freeze the public grammar based on this experiment.

Primary references:

- [Langium document lifecycle](https://langium.org/docs/reference/document-lifecycle/)
- [Langium validation](https://langium.org/docs/learn/workflow/create_validations/)
- [Langium generated AST](https://langium.org/docs/learn/workflow/generate_ast/)
- [chessops](https://github.com/niklasf/chessops)
- [rust-analyzer lossless syntax design](https://rust-analyzer.github.io/book/contributing/syntax.html)

Observed result, 2026-11-02: the prototype links a two-module narrative comparing the Opera Game and Réti–Tartakower, lowers it to plain validated data, and resolves both board positions. It reproduces untouched LF/CRLF source through a JSON envelope and rejects retained source that disagrees with edited structured data. Canonical structured-to-text-to-structured conversion succeeds for the example.

A real stdio JSON-RPC client verified initialization, legal SAN completion (`Qb8+` among 46 choices), a ranged illegal-answer diagnostic, cross-file definition navigation, dependency invalidation when a game export changes, and clean shutdown. Type-checking and the repository's 29 existing tests passed. The [branch results](https://github.com/phibkro/chess-anthology/blob/prototype/langium-chess-compiler/prototypes/chess-compiler/RESULTS.md) distinguish these observations from unimplemented capabilities.

Verdict: continue investigating Langium as the frontend. It has not yet demonstrated source-preserving semantic edits, browser packaging, foreign-PGN normalization/loss reporting, or EPD/database adapters. The source-preserving envelope is an intermediate experiment, not the finished isomorphic codec.

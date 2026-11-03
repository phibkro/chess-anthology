# A Go counterpart to the chess compiler

Current layout: the supported Bun module lives in `compiler/`. Go implementation and Go-specific CI are retained on [experimental/go-compiler](https://github.com/phibkro/chess-anthology/tree/experimental/go-compiler). Historical measurements below refer to their recorded revisions. To include Go in a new experiment, supply its separate module checkout via `CHESS_GO_MODULE` (execution modes) or `--go-module` (LSP). Default LSP experiments exercise Bun delivery modes only; `--arms all` also includes installed historical Node controls and includes Go only when its module is supplied.

Research date: 2 November 2026. This report records the original design and library audit. Update, 3 November 2026: an independent [Go compiler prototype](https://github.com/phibkro/chess-anthology/blob/experimental/go-compiler/prototypes/chess-compiler-go/README.md) now implements the public compiler/codec/playback seams and participates in shared evaluations and benchmarks. The [tooling refresh](go-compiler-tooling.md) led to adopting Fastbelt syntax generation instead of the handwritten-parser proposal below. Statements about scratch-only probes describe the original audit, not the newer compiler implementation.

## Recommendation

A Go compiler is feasible as an implementation of the same public contracts. Keep the current TypeScript/Bun compiler while developing a small, separately evaluated counterpart. Start with a handwritten lexer/parser and a replaceable chess adapter. The expanded audit makes `chesshere-com/chess-on-go` the first rules-backend candidate, ahead of the initial `corentings/chess` recommendation, because its Chess960 behavior has both source/test evidence and targeted probe results. It still needs our own lossless PGN/EPD syntax layer. JavaScript string preservation remains a separate parity risk.

This recommendation is an engineering inference from the inspected grammar, contracts and sources below. It does not establish that Go would be faster, simpler overall, or a complete substitute for Langium's editor/workspace infrastructure.

## What “equivalent” means

Use the existing [phase definitions](../../MODULES.md), [contract/evaluation specification](../compiler-evaluations.md), [grammar](../../compiler/src/compiler/100-parsing/chess-narrative.langium) and [corpus manifest](../../compiler/evaluation/corpus/manifest.json) as the acceptance sources. Equivalence concerns observable behavior, not matching class layouts or recreating Langium in Go.

| Current contract | Proposed Go representation | Required behavior |
| --- | --- | --- |
| Authored document | Versioned structs and a tagged annotation union | Ordered stories, scenes and notes; module imports/exports; safe-integer anchors; structural validation |
| Failure / diagnostic | Typed errors and diagnostic records | Stable code, phase, severity, structured path and source range |
| Recorded history | Private immutable history plus frame DTOs | Initial position at index zero; canonical SAN/UCI and expected FEN convention |
| Emitted document | Plain document/occurrence records | No parser or chess-library objects in consumer output |
| Build snapshot/work | Snapshot handle plus revision/work DTOs | Stable retained revisions; clean/incremental agreement; explicit invalidation counters |
| Playback plan | Existing version-1 JSON shape | Same three-scene corpus output, annotation order and resolved prompt answers |
| Source envelope | Original source, structured value and digest | Exact restoration only when source and model still agree |

Do not call a standard-chess-only compiler fully equivalent: the existing analysis advertises standard chess and Chess960. Likewise, EPD/database imports and comprehensive PGN export-loss reports are future capabilities in the current prototype, not already implemented behavior a Go port can claim to inherit.

## File and package organization

A future `prototypes/chess-compiler-go/` module would contain:

| Location | Responsibility |
| --- | --- |
| `contracts/` | Public DTOs, versions, diagnostics, validation and string representation |
| `compiler.go` | Small public compile/update/select API |
| `internal/phases/100-parsing/` | Tokens, syntax tree, trivia spans, parse recovery |
| `internal/phases/200-semantic-analysis/` | Lowering, local invariants and duplicate detection |
| `internal/phases/300-linking/` | Symbols, imports/exports, dependency and reverse-dependency edges |
| `internal/phases/400-chess-analysis/` | Chess adapter, branch validation, replay cache and recorded frames |
| `internal/phases/500-emission/` | Plain output, playback target, canonical printer and source envelope |
| `internal/phases/600-build/` | Revision diffing, invalidation, publication of immutable snapshots |
| `internal/adapters/`, `cmd/chess-compiler/`, `cmd/chess-lsp/` | Filesystem, CLI and editor protocol integration |
| `evaluation/`, `testdata/` | Shared corpus adapter, differential tests and benchmark report writer |

The numbered directories can use ordinary package names such as `parsing`; the directory number records the phase. Go's `internal` convention restricts outside imports, but it does not enforce all permitted dependencies between sibling phases. Retain a dependency-direction test and expose only each phase's intended operations. [Go module-layout guidance](https://go.dev/doc/modules/layout)

## Parser choices

| Option | Verified capability | Assessment for this grammar |
| --- | --- | --- |
| Handwritten recursive descent | Proposed implementation, not an existing Go compiler | Small explicit grammar; direct control over JSON escapes, trivia and recovery. Recommended first experiment. |
| Participle v2 | Grammar embedded in Go types; positional fields and token capture; comments can remain available as tokens | Good alternative for faster grammar iteration. Its parser does not supply linking, build invalidation or a source-preserving editor automatically. [Participle](https://github.com/alecthomas/participle) |
| Tree-sitter | Incremental syntax parsing with a concrete tree and official Go bindings to its C implementation | Worth testing if resilient partial-document editing dominates. Adds a grammar/toolchain and native integration; AST lowering and semantic invalidation still belong to us. [Tree-sitter](https://tree-sitter.github.io/tree-sitter/using-parsers/), [Go bindings](https://github.com/tree-sitter/go-tree-sitter) |
| ANTLR | Generates a Go-target parser supported by its runtime; generation uses the ANTLR tool | Useful if sharing a grammar across implementations becomes a priority. More generated machinery for the current small language; no automatic equivalent of Langium's complete workspace lifecycle. [Targets](https://github.com/antlr/antlr4/blob/dev/doc/targets.md), [Go runtime](https://github.com/antlr4-go/antlr) |

For the first experiment, retain every token's byte span and keep the original source separately. Skipping comments semantically need not discard their source locations. An exact untouched-source envelope is smaller in scope than an editing codec: preserving comments after semantic edits additionally requires a concrete syntax/trivia model and a policy for attaching moved or deleted trivia.

## Updated chess-library audit

The initial audit covered `corentings/chess` and archived `notnil/chess`. The following wider audit changes the preferred rules backend. Commit dates describe observed maintenance activity, not promised future support; versions and licenses must remain pinned when adopted.

| Candidate / inspected revision | Verified strengths | Observed limits / decision |
| --- | --- | --- |
| `chesshere-com/chess-on-go` v0.22.2, `602965ee`, 24 October 2026; MIT, Go 1.25 | Explicit variant constructors; recorded castling-rook origins; Shredder-FEN output; dedicated stationary-king, swapped-piece, safe-path and rights-loss tests | Preferred rules adapter. Its actual `LoadPGN` ignores variations/comments/NAGs. EPD operations use a map, losing repeated-opcode boundaries and original order. |
| `corentings/chess/v2`, `c5e00388`, 25 October 2026; MIT, Go 1.25 | PGN variation children and structured comments, including embedded commands | Retain as a standard-chess/notation candidate. Castling hard-codes orthodox king squares; one NAG field can overwrite multiple glyphs. Not full Chess960 parity. |
| `lavren1974/chess960`, `a3916915`, 11 April 2026; MIT, Go 1.25.5 | Has explicit Chess960 castling helpers and a castling test | Reject for adoption at this revision: a probe generated a castle with `-` castling rights; Shredder `H` rights were rejected. Name/README does not establish correctness. |
| `alex65536/go-chess`, `048aa687`, 5 July 2026; MIT, Go 1.22 | Independent standard-chess primitives and FEN/SAN/UCI support | The README explicitly lists PGN and Chess960 as not implemented. Not an equivalent narrative backend. |
| `notnil/chess`, `1cbb4564`; MIT | Historical standard-chess implementation | Archived 25 January 2025; its PGN path strips variations. Do not select as the new narrative importer. |

Primary sources: chess-on-go [license](https://github.com/chesshere-com/chess-on-go/blob/602965ee5ed378310a07582d8aeb9303c567de68/LICENSE), [module](https://github.com/chesshere-com/chess-on-go/blob/602965ee5ed378310a07582d8aeb9303c567de68/go.mod), [variant contract](https://github.com/chesshere-com/chess-on-go/blob/602965ee5ed378310a07582d8aeb9303c567de68/docs/variants.md), [castling tests](https://github.com/chesshere-com/chess-on-go/blob/602965ee5ed378310a07582d8aeb9303c567de68/castling_chess960_test.go), [FEN tests](https://github.com/chesshere-com/chess-on-go/blob/602965ee5ed378310a07582d8aeb9303c567de68/fen_chess960_test.go), [PGN implementation](https://github.com/chesshere-com/chess-on-go/blob/602965ee5ed378310a07582d8aeb9303c567de68/pgn.go), [EPD implementation](https://github.com/chesshere-com/chess-on-go/blob/602965ee5ed378310a07582d8aeb9303c567de68/epd.go). Its module includes notnil for differential tests/benchmarks; that is not evidence of a complete notation-preserving importer.

Other pinned evidence: corentings [license](https://github.com/CorentinGS/chess/blob/c5e003889e8e8a9b9eeb6651019c34b14267b5bb/LICENSE), [module](https://github.com/CorentinGS/chess/blob/c5e003889e8e8a9b9eeb6651019c34b14267b5bb/go.mod), [PGN tests](https://github.com/CorentinGS/chess/blob/c5e003889e8e8a9b9eeb6651019c34b14267b5bb/pgn_test.go), [castling](https://github.com/CorentinGS/chess/blob/c5e003889e8e8a9b9eeb6651019c34b14267b5bb/engine.go), [move/NAG model](https://github.com/CorentinGS/chess/blob/c5e003889e8e8a9b9eeb6651019c34b14267b5bb/move.go); lavren [castling source](https://github.com/lavren1974/chess960/blob/a39169151318d18f4db6594d95c8f546f6981e6e/engine.go), [FEN](https://github.com/lavren1974/chess960/blob/a39169151318d18f4db6594d95c8f546f6981e6e/fen.go), [license](https://github.com/lavren1974/chess960/blob/a39169151318d18f4db6594d95c8f546f6981e6e/LICENSE), [module](https://github.com/lavren1974/chess960/blob/a39169151318d18f4db6594d95c8f546f6981e6e/go.mod); alex [declared omissions](https://github.com/alex65536/go-chess/blob/048aa6870e9169f458f6f93317ca5ab870ea5a35/README.md), [license](https://github.com/alex65536/go-chess/blob/048aa6870e9169f458f6f93317ca5ab870ea5a35/LICENSE); notnil [archive notice](https://github.com/notnil/chess), [PGN source](https://github.com/notnil/chess/blob/1cbb4564a26ff96dbe4bb54449eeb0e18e8a49e8/pgn.go).

### Executed bounded probes

A scratch-only probe ran under official Go 1.27.3 on Linux/amd64, with the downloaded toolchain archive checked against the [Go download manifest](https://go.dev/dl/?mode=json). No Go compiler implementation or dependency was added to this project. A targeted upstream run, `go test -run 'Chess960|PGN|EPD' -count=1 -json`, passed 80 top-level chess-on-go tests and their subtests.

Independent small fixtures produced these observations:

| Probe | chess-on-go v0.22.2 result |
| --- | --- |
| Double-move, stationary king, stationary rook, king/rook swap | Expected final king/rook squares in all four cases |
| Black stationary king; attacked transit; no castling rights | Expected behavior in the selected fixtures |
| Generate all 960 indices | 960 distinct ranks with opposite-colour bishops, king between rooks, mirrored armies and FEN roundtrips |
| Orthodox array under explicit Chess960 rules | Ruleset retained rather than inferred from placement |
| Illegal move in a side variation | Accepted because the variation was ignored: fails our all-branches validation requirement |
| Comments, two NAGs, variation and arrow extension on PGN export | All absent after import/export: fails narrative preservation |
| Duplicate EPD `custom` operations | Only the final operand retained: fails lossless operation preservation |

For lavren, `4k3/8/8/8/8/8/8/4K2R w - - 0 1` yielded one castling move, and `6k1/8/8/8/8/8/8/6KR w H - 0 1` was rejected. The first agrees with the inspected code deriving availability from current rook placement instead of historical rights. These probes are counterexamples and bounded positive checks, not proof that every remaining chess-on-go rule is correct. Full branch, ambiguity, rights-loss and mutation-isolation coverage remains an adoption gate.

### Proposed Chess960 profile to ratify

The [2023 FIDE Laws, Guidelines II](https://handbook.fide.com/chapter/E012023) define the initial-array restrictions and four possible castling motions; final king/rook squares remain c/d or g/f. The [Chess960.net reference](https://chess960.net/start-positions/) is useful for the 960-position catalogue and explains why ordinary `KQkq` is unambiguous for a full initial array but can lose rook identity in later setups. It is not the normative source for PGN tag spelling: the [PGN specification, §§9.7.1–9.7.2](https://www.saremba.de/chessgml/standards/pgn/pgn-complete.htm#c9.7.1) uses **`SetUp`**, whereas that page's example says `Setup`.

The following are proposed project decisions, distinct from claims about the present parser or universal PGN conventions:

- **Ruleset is explicit data.** Resolve an artifact's configured ruleset and PGN `Variant`; reject conflicts and unsupported names. With neither present, default to standard chess. Piece placement alone never selects Chess960, including orthodox array #518.
- **Initial array and setup position are different inputs.** Apply all 960-array restrictions only to a generated/claimed initial array. A composition or midgame FEN need not retain the complete mirrored armies, bishops or original material. Validate it as a setup under the selected rules, without inventing its prior history.
- **No guessed start.** Strict Chess960 game import requires an explicit FEN setup or an explicitly supplied starting index. It must not silently randomize or choose #518. For FEN setups, require canonical `SetUp "1"` and `FEN`; a compatibility mode can preserve and diagnose noncanonical/missing tags without concealing repair.
- **Rights identify entitled rooks.** Store king/rook origins and surviving historical rights separately from piece placement. Canonical Chess960 FEN output uses explicit Shredder rook-file letters. Accept traditional `KQkq` or X-FEN conventions only through a declared, tested dialect with deterministic rook resolution; diagnose missing/ambiguous/conflicting rights. Never restore rights because a king/rook returned to its old square.
- **Move notation has a profile too.** Preserve SAN castling semantics, and label UCI castling encoding explicitly. Do not mix king-destination coordinates with king-to-rook Chess960 coordinates without conversion. Keep source notation alongside canonical moves and report transformations.

The explicit-rook convention is supported by the candidate's [variant documentation](https://github.com/chesshere-com/chess-on-go/blob/602965ee5ed378310a07582d8aeb9303c567de68/docs/variants.md); the difference between X-FEN's outer-rook shorthand and explicit inner-rook letters is also visible in [Stockfish's FEN parser](https://github.com/official-stockfish/Stockfish/blob/master/src/position.cpp). These are interchange profiles; FEN's six fields do not themselves identify a ruleset.

Before calling the profile ratified in code, make its cases shared fixtures: all 960 arrays; setup positions with reduced material; all four castling motions for both colours; king attacked before/in transit/after; occupied paths; rook-origin attacks; moved/captured rook rights; ambiguous additional rooks; and conflicting/missing metadata. Keep unsupported cases explicit instead of delegating undocumented defaults to whichever engine is selected.

## Losslessness must be designed above the chess library

The current property suite includes lone UTF-16 surrogates such as `\uD800`, not just ordinary Unicode text. JavaScript strings can preserve those code units. Go strings contain bytes; normal rune decoding and the default `encoding/json` decoder do not give the same semantics. The JSON decoder documents replacement of invalid surrogate pairs with U+FFFD; a scratch Go 1.27.3 probe confirmed that decoding `"\ud800"` succeeds and yields U+FFFD. A direct JSON-to-Go-struct port would fail our existing roundtrip property. [Go strings](https://go.dev/blog/strings), [encoding/json](https://pkg.go.dev/encoding/json)

Full parity therefore requires a deliberate string contract: for example, a UTF-16-code-unit-backed text value with a custom JSON/string-token codec preserving lone surrogate escapes. Original source bytes and lexical escapes remain separate from semantic text. Apply this consistently to every unrestricted string field, including paths, not just prose. Alternatively, a Unicode-scalar-only profile must be a declared, versioned restriction with explicit rejection; it cannot silently replace the current contract.

Also preserve absent versus null fields, empty arrays versus nil slices, reserved identifiers, exact safe-integer bounds through `2^53 - 1`, and rejection of negative zero. Decode structured values through validation rather than assuming Go field types enforce the whole schema. Inspect and reject unknown fields and duplicate keys according to an explicit document policy. [JSON decoding behavior](https://pkg.go.dev/encoding/json#Unmarshal)

The format split should remain explicit:

- **PGN:** original text plus an ordered syntax representation of tags, moves, recursive variations, comments, NAGs and unknown extensions. A chess library supplies legality, not a guarantee of source fidelity.
- **FEN:** a position projection with a declared normalization policy. Replayed frames do not retain the story, move tree or annotation provenance. Match the corpus's uncapturable-en-passant normalization deliberately.
- **EPD:** position fields plus ordered operations and typed operands, retaining unknown operations and original spelling. The candidate has useful EPD helpers, but its map representation demonstrably loses repeated operations; it cannot be our lossless EPD IR.
- **Narrative:** story structure, game references, board annotations and interaction semantics remain owned by our contracts, not overloaded into a chess engine's internal move type.

Every export operation should report preserved, transformed, omitted and unsupported capabilities. An unchanged-source restoration can return exact original bytes; a canonical export is a different operation. Reject unsupported rules/features when no explicit lossy-export mode is selected. Keeping the raw source does not by itself prove that semantic edits preserve unknown extensions correctly.

## Build state, errors and editor support

Use maps for symbols and URI-indexed sources, ordered slices for authored sequences, and reverse adjacency lists for invalidation. Compute content digests from the exact specified source encoding, library/rules configuration and contract version. Reuse unaffected parsed modules, emission values and game histories. A prose edit must not replay chess; a changed shared PGN invalidates its dependent documents.

Go supports errors as returned values naturally. Use idiomatic `(value, error)` inside Go, with typed failure kinds/codes; map to the existing discriminated JSON result at an external boundary. Successful compilation may contain document diagnostics. Invalid input must not cause a panic, and a publication adapter must check error diagnostics rather than treating a completed build as publishable. [Go error guidance](https://go.dev/doc/tutorial/handle-errors), [errors are values](https://go.dev/blog/errors-are-values)

Go structs do not make their contained maps or slices immutable. Keep builder-owned mutable values private, publish fresh snapshots, and return copied DTOs or query results so consumers cannot mutate retained revisions through aliases. Start with sequenced writes and explicit busy/failure states; introduce parallel replay only after deterministic behavior and ownership tests exist. Select-position operations remain reads, not events or new revisions. [Go specification: reference-bearing values](https://go.dev/ref/spec#Representation_of_values)

Use a small LSP adapter over the compiler. `go.lsp.dev/protocol` is a candidate for protocol types and dispatch; it does not implement this language's analysis. Avoid importing `gopls/internal/protocol`, which is an internal package. Keep byte offsets internally and an indexed conversion to our zero-based UTF-16 source ranges. LSP defaults to UTF-16 when another encoding is not negotiated; a non-BMP symbol occupies two UTF-16 units. Test CRLF, supplementary characters and changes before diagnostics. [Protocol package](https://github.com/go-language-server/protocol), [LSP position contract](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.18/specification/#position)

## A small implementation sequence

1. **Codec slice:** versioned Go DTOs, strict structured validation, lexer/parser and canonical printer. Reuse authored-value cases; pass semantic roundtrips and exact source-envelope restoration before adding chess.
2. **Playable slice:** one historical game and one composition position through linking, legal replay and version-1 playback JSON. Compare all three corpus scenes, annotation ordering, SAN/UCI answers and selected FENs against the shared manifest.
3. **Diagnostic slice:** reproduce the seven invalid cases' stable codes, phases, offending-token spans and recovery after correction. Preserve errors as values for malformed input.
4. **Incremental slice:** add source diffs, dependency edges, cache identities and immutable snapshot publication. Match all eight deterministic work-budget checks and clean/incremental results over generated edit histories.
5. **Editor/performance slice:** add the LSP adapter and comparative benchmark process. Expand unsupported-format/variant coverage before claiming full parity.

Go's native fuzzing supports seeded corpus execution in ordinary tests and coverage-guided fuzzing separately. Use it for byte inputs, structured/flat roundtrips, arbitrary malformed PGN, edit sequences and snapshot aliasing. Keep generated cases and minimized regressions shared across implementations where possible; do not compare only one implementation's self-generated output with itself. [Go fuzzing](https://go.dev/doc/security/fuzz/)

## Benchmarking the alternative fairly

Use the same workload bytes and expected outputs, pinned compiler/dependency commits, hardware identity and process environment. First pass correctness, capability and work-budget parity; a compiler that skips side-variation validation is doing less work. Separate startup, initial compilation, unchanged updates, prose edits, shared-game invalidation and long-lived retained-memory behavior.

For Go microbenchmarks, `testing.B.Loop` helps control setup/cleanup boundaries and compiler elimination; allocation reporting and profiling can explain costs. The cross-language comparison should still use the common external process harness and report per-process measurements. Do not compare a Go benchmark loop's `ns/op` directly with a Bun CLI's total startup time. [Go benchmark guidance](https://go.dev/blog/testing-b-loop), [testing API](https://pkg.go.dev/testing#B.ReportAllocs), [profiling](https://go.dev/doc/diagnostics)

Record Go toolchain/build flags, `GOMAXPROCS`, `GOGC`, `GOMEMLIMIT`, warmup policy and whether caches are cold. Heap allocation, retained heap and RSS are separate measurements. Do not disable Go's GC to win against normally configured runtimes. [Go GC guide](https://go.dev/doc/gc-guide)

Use balanced repeated fresh-process blocks, effect sizes and uncertainty rather than a single faster run. `benchstat` can summarize repeated Go benchmark results, but cross-language results need the shared timing definitions. Distinguish two conclusions: Node versus Bun on identical TypeScript isolates a runtime change; Go versus the TypeScript implementation measures the entire implementation, parser and chess-library design as well. No compiler-performance conclusion about Go is supported yet; the executed library correctness probes are not performance benchmarks. [benchstat](https://pkg.go.dev/golang.org/x/perf/cmd/benchstat)

## Reproducing the bounded acceptance probes

The [probe results](evidence/go-chess-library-probes.json) and [standalone audit harness](evidence/go-probe/main.go) are committed with pinned Go module checksums. From `docs/research/evidence/go-probe`, run `go run .` for the chess-library probes and `go run ./unicode` for the surrogate-decoding probe. These are research checks, not a Go compiler implementation or a project runtime dependency. The report records failures as capability gaps rather than treating all candidate-library behavior as accepted behavior.

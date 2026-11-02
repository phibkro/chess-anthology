# Compiler contracts and evaluations

## Terms and organization

Use **contract** for the obligations at a seam: accepted data, invariants, errors, and guarantees. Use **intermediate representation (IR)** for the data passed across that seam. **Specification** names the wider intended behavior, including these contracts and their executable evaluations. These are engineering terms rather than additions to the anthology's reader-facing glossary.

Plain representations live in `prototypes/chess-compiler/src/contracts/`:

| Contract | Owner / consumers | Obligations |
| --- | --- | --- |
| `authored.ts` | Semantic analysis, codecs | Structural schema and authored document IR; valid shape does not establish linked references or legal chess |
| `core.ts` | All phases | Explicit result/failure values, structured issues and read-only views |
| `history.ts` | Chess analysis, emission, build | Initial frame at index zero; recorded mainline frames and source digest; mutable engine positions remain private |
| `emission.ts` | Emission, build, consumers | Framework-free document IR, board occurrences, diagnostics, zero-based UTF-16 ranges with exclusive ends |
| `build.ts` | Build, adapters | Complete source maps, immutable revision snapshots and deterministic phase-work reports |
| `playback.ts` | Playback target, browser reader | Versioned, structurally validated reader plan; supported prompts follow the recorded mainline |

Implementations must satisfy these declared types; contracts do not derive their shape from implementation return types. Imports between phases still pass through each numbered directory's `index.ts`. The plain contract module cannot import compiler implementations, Langium, chessops or Node facilities. The architecture test enforces these dependency directions for current static imports.

The syntax IR is different: `100-parsing/contract.ts` exposes the generated Langium AST types through the parsing entrypoint. That graph remains framework owned. Linking still uses Langium's workspace lifecycle internally; this change does not pretend a standalone linked IR exists or replace that lifecycle with six independently scheduled passes.

A TypeScript contract does not validate external JSON by itself. Authored documents and playback plans have runtime Valibot validation; snapshots and emission types are internal compiler products. Do not accept external serialized snapshots as trusted values merely because their TypeScript interface exists.

## Executable evaluation specification

The corpus, harness and report types live in the compiler's `evaluation/` directory. `corpus/manifest.json` versions the cases and records provenance and expected positions. `report-contract.mts` declares the versioned JSON report shapes.

The first acceptance slice requires:

- A story spanning opening play, historical play and a composed position compiles to three reader scenes, preserving arrows and prompts.
- Seven broken-source cases produce their specified diagnostic code and phase; the diagnostic span covers the offending token and an explanation is present.
- Correcting each broken case clears stale diagnostics in the same compiler.
- Hand-specified position expectations and pinned history lengths agree with selection results. FEN emission normalizes an uncapturable en-passant target to `-`; the corpus explicitly records that convention.
- Structured/flat roundtrips preserve the model; source envelopes restore exact text and reject changed source. The existing seeded property suite retains its broader Unicode, CRLF, malformed-input and edit-history coverage.
- Initial, unchanged, prose-edit and shared-game-edit builds match clean results and their phase-work budgets for one and eight importing stories.

The corpus does not establish an independent full-game chess oracle, full PGN loss reporting, selectable side variations, EPD imports, exact expected ranges for every Unicode input, or human-rated diagnostic usefulness. Those are explicit follow-ups, not capabilities implied by these passing cases.

## Deterministic budgets

For N importing story documents, one library and one shared PGN:

| Operation                 | Parsed | Replayed | Emitted |
| ------------------------- | -----: | -------: | ------: |
| Initial                   |  N + 1 |        1 |   N + 1 |
| Identical update          |      0 |        0 |       0 |
| One story's prose changes |      1 |        0 |       1 |
| Shared PGN changes        |      0 |        1 |   N + 1 |

These counters do not account for scanning, hashing or garbage collection. The whole-operation timings are needed to expose costs outside the named phase work.

## Running and comparing

From the repository root:

```sh
pnpm --dir prototypes/chess-compiler eval
pnpm --dir prototypes/chess-compiler bench
```

Both commands write JSON to stdout and failures to stderr with a nonzero exit. The required `check:compiler` includes evaluations alongside types and property tests. Benchmark sizes default to 1, 10 and 100 stories, with three warmups and ten measured samples. Override `CHESS_BENCH_SIZES`, `CHESS_BENCH_WARMUPS` and `CHESS_BENCH_ITERATIONS` for larger experiments.

The benchmark measures compiler creation plus initial compilation in an already running process, and three warm-update scenarios. Source generation, file reads, initial workspace population for updates, and result checks stay outside each timed interval. Each sample uses a fresh workspace; the update being measured is its second build. Shared-game edits use changed source content to avoid measuring a replay-cache hit by accident. This does not model a long-lived editing session.

Reports include raw latency and RSS samples, median, nearest-rank p95, compiler commit, compiler dirty status, compiler lockfile digest, corpus/workload digest, harness digest, runtime and hardware identity. RSS includes untimed setup and other process activity; it is not operation allocation or retained-heap growth. With few samples, p95 is descriptive rather than a reliable tail-latency estimate. Dirty local runs are exploratory; use clean committed revisions for baselines.

The separate, nonblocking GitHub benchmark job copies this exact harness into a worktree of the PR's base revision, then runs both revisions sequentially on the same runner. It uploads JSON artifacts and puts the median comparison in the job summary. `compare.py` rejects incompatible harnesses, environments, sample counts, workloads or scenario sets. The compiler revisions and lockfiles may differ and remain identified in the reports. Fixed base-first ordering can introduce bias; there are no timing regression gates until variance is characterized.

Keep correctness/work budgets blocking. Later steps are independent chess cross-checks, a larger provenance-pinned corpus, allocation/retention measurements, long-lived edit sequences, process-start/LSP measurements, and mutation testing of handwritten validation and invalidation logic. Choose regression thresholds from measured variance rather than inventing a percentage now.

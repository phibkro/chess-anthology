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

For ordinary same-runtime comparisons, `compare.py` rejects incompatible harnesses, environments, sample counts, workloads or scenario sets. Compiler revisions and lockfiles may differ and remain identified in the reports. The migration job below uses a different three-arm design because Bun-native code cannot run under Node. There are no timing regression gates until variance is characterized.

Keep correctness/work budgets blocking. Later steps are independent chess cross-checks, a larger provenance-pinned corpus, allocation/retention measurements, long-lived edit sequences, process-start/LSP measurements, and mutation testing of handwritten validation and invalidation logic. Choose regression thresholds from measured variance rather than inventing a percentage now.

## Bun migration comparison

Bun 1.4.4 is now the project runtime; pnpm remains the package manager. Benchmark and evaluation report version 2 records the actual Bun version instead of Node's compatibility `process.version`. The Node-era base report remains version 1 and is consumed explicitly by the migration experiment; its raw fields are not silently reinterpreted as version 2.

`evaluation/runtime_compare.py BASE_COMPILER CURRENT_COMPILER OUTPUT_DIRECTORY` runs three arms: unchanged base compiler under Node, that identical base under Bun, and migrated compiler under Bun. The first pair isolates runtime behavior; the full migration additionally includes native Bun APIs and lint-driven refactors. The unchanged base's own locked dependencies, corpus, harness and correctness evaluations are retained. Do not copy the Bun-only harness into the Node baseline.

The default experiment uses 12 blocks. Each arm runs in a fresh process once per block; seeded permutations balance arm order. Each process measures five samples after two warmups for every scenario. Statistical inference uses the 12 paired **process medians**, not all within-process samples as if independent. The report shows geometric-mean paired latency ratios, nominal 95% paired bootstrap intervals (10,000 resamples), exact two-sided sign-flip tests on log ratios, and Holm-adjusted p-values across all 36 scenario/comparison tests. An adjusted p below 0.05 indicates a detectable difference under the experiment's exchangeability assumptions, not that a speed difference is practically important. Shared-runner noise, JIT/GC and small absolute latencies still require judgment.

Correctness/work budgets remain blocking. Timing significance is reported, not a merge gate. The PR job summary and `compiler-runtime-comparison` artifact contain the method, arm schedule, runtime identities, raw reports and effect estimates. The Python statistical helper's deterministic self-tests are part of quality checks. The Bun LSP also has a stdio initialize/open/imported-game/shutdown smoke check, including empty diagnostics for the valid example workspace.

For later PRs with a Bun-native base, the job detects the base package `engines.bun` contract, copies the evaluation harness into the disposable base worktree, and runs a paired Bun-versus-Bun experiment. It does not invoke Node or require removed tsx dependencies for a Bun-era base. Runtime-selection self-tests cover both experiment plans. The unchanged Node-era harness is retained only for the three-arm migration experiment.

### Chess960 conformance

The compiler test command also runs `src/chess960.test.ts`: all 960 independently enumerated complete starting arrays, 12 literal accepted castling fixtures through compilation/selection/lesson emission, eight rejected castling fixtures, and explicit missing-setup diagnostics. Shared edge cases are versioned in `evaluation/corpus/chess960.json`; they can be reused by another rules adapter without importing the TypeScript test runner. See the [compatibility profile](research/chess960-compatibility-profile.md) for the implemented subset and remaining proposals.

### Delivery and compilation modes

The [execution-mode experiment](compiler-execution-modes.md) evaluates source execution, bundles, Node code cache/SEA, Bun executables and bytecode, with native AOT capability detection. It reports first-compilation wall time separately from warm operations and compares delivery modes within each compiler revision.

### Editor protocol

The [LSP evaluation suite](compiler-lsp-evaluations.md) exercises real editor messages against Go, maintained Bun delivery modes and frozen Node-era controls. It separates startup through first diagnostics from persistent-session edits/queries and records unsupported historical behavior explicitly.

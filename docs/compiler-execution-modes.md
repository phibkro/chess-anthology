# Compiler execution modes

Current layout: the supported Bun module lives in `compiler/`. Go implementation and Go-specific CI are retained on [experimental/go-compiler](https://github.com/phibkro/chess-anthology/tree/experimental/go-compiler). Historical measurements below refer to their recorded revisions. To include Go in a new experiment, supply its separate module checkout via `CHESS_GO_MODULE` (execution modes) or `--go-module` (LSP). Default LSP experiments exercise Bun delivery modes only; `--arms all` also includes installed historical Node controls and includes Go only when its module is supplied.

The maintained compiler currently runs TypeScript under Bun. The historical Node implementation runs through tsx. Neither uses a single-executable build in normal project commands. Both ordinary runtimes can JIT-compile hot JavaScript; TypeScript transpilation, bundling, bytecode generation, runtime snapshots and native ahead-of-time compilation are different operations.

## Compared artifacts

| Revision | Mode | What changes |
| --- | --- | --- |
| Pinned Node-era compiler | Node + tsx | Source execution control; runtime transpilation |
| Same Node-era compiler | Node + CommonJS bundle | esbuild 0.25.12 removes TypeScript and bundles dependencies before launch |
| Same Node-era compiler | Node bundle + populated compile cache | V8 persisted code cache; still uses JIT, not native AOT |
| Same Node-era compiler | Node SEA, with/without code cache | Runtime plus bundle in an executable; optional V8 code cache |
| Same Node-era compiler | Bun source | Identical-implementation runtime control |
| Current compiler | Bun source | Maintained implementation control |
| Same current compiler | Bun JavaScript bundle | Build-time bundling/transpilation, JIT at runtime |
| Same current compiler | Bun executable | Runtime plus bundled application, JIT at runtime |
| Same current compiler | Bun executable + bytecode | Adds build-time bytecode generation, JIT remains |
| Same current compiler | Bun native AOT, if verified available | Documented `bun compile` behavior must pass a capability probe; a successful unknown `--aot` flag does not establish support |

Node arms use the pinned historical commit `f2068c0d8ab86c80706fa59867e127101fa51fae`; current authored code remains Bun-native. Compare packaging effects **within each revision**. Comparing a legacy Node artifact with a current Bun artifact also includes implementation changes. Source and executable controls share staged entry code and identical dependencies within each revision. Node bundles use the historical lockfile's esbuild, while Bun artifacts use Bun's bundler. An initial Bun CommonJS build for Node failed correctness with `ReferenceError: exports_index_esm is not defined`; its timing is not an accepted comparison.

Bun 1.4.4's published AOT documentation describes `bun compile` and type-directed native compilation. The installed release binary instead reports `Script not found "compile"`. Moreover, `bun build --compile` accepts both `--aot` and a deliberately nonexistent option, even for a documented type-error example. The harness therefore records AOT as unavailable on that binary. It does not relabel a JIT executable as native code. Another Bun can be selected through `CHESS_BUN`; a verified capability followed by a failed compiler build is recorded separately.

Node SEA and code cache are available in the selected Node 24 runtime. Startup snapshots are not measured here: they require an initialization/serialization boundary, rather than simply rebuilding the same entry file, and should get a separate capability/equivalence experiment. Node's SEA `useCodeCache` is not a native machine-code AOT compiler.

Primary references: [Bun executable builds](https://bun.sh/docs/compiler/executables), [bytecode](https://bun.sh/docs/compiler/bytecode), [native AOT](https://bun.sh/docs/compiler/aot), [AOT compatibility](https://bun.sh/docs/compiler/compatibility), [Node SEA](https://nodejs.org/docs/latest-v24.x/api/single-executable-applications.html), [Node module compile cache](https://nodejs.org/docs/latest-v24.x/api/module.html#module-compile-cache).

## Evaluations and timing boundaries

`evaluation/execution_modes.py` stages the existing acceptance and benchmark entry files. It relocates relative imports and source-relative corpus URLs, wraps their top-level bodies in async functions for CommonJS/SEA compatibility, and replaces only untimed provenance collection with build-recorded metadata. Compiler implementations and assertion/timing bodies are not rewritten. Generated files and binaries stay under ignored `report/` paths. Corpus assets remain on disk: this experiment does not prove a distributable executable embeds all required resources.

Each built artifact must pass the existing eight acceptance cases (including diagnostic ranges, recovery, codec/envelope checks and all three playback scenes) and eight work budgets. Evaluation digests, cases and budgets must match the source control for that revision. Failed modes are excluded from timing, recorded explicitly and cause an unsuccessful experiment exit. Required source controls must pass. These are acceptance evaluations, not the full property/fuzz suite inside every artifact.

The default is 16 paired blocks. Each block launches a fresh process per arm for the warm benchmark and another process for one first compilation. Arm order rotates from a seeded permutation and reverses on later cycles. Five measured samples follow two warmups per workload; workload order within a process remains fixed at 1/10/100 stories, so size-to-size comparisons are not isolated warmup experiments.

| Measurement | Includes | Excludes |
| --- | --- | --- |
| First compilation wall time | Process launch, module initialization, one-story compilation, JSON output and process exit | Artifact construction and dependency installation |
| Warm operations | Fresh compiler creation for initial builds; prepared incremental updates for other cases | Process launch, module loading, untimed initial population |
| Build duration and artifact size | One observed construction duration and file size | Repeated-build statistical inference; source modes have no standalone artifact |
| RSS | Whole-process samples retained in raw benchmark reports | Per-operation allocation accounting |

The shared driver contains evaluation and timing modules even when selecting first compilation; its startup is not a minimal production CLI measurement. Code-cache controls are explicitly prepopulated outside timing. Other arms do not inherit the parent's Node compile cache, cache-disable switch or runtime-option environment. Untimed preparation verifies that Node reports an active cache directory and that it contains entries. These are warm filesystem/page-cache measurements, not disk-cold launches. Compiler cache state resets as specified by the existing benchmark.

Effects use paired per-process medians, geometric-mean latency ratios, nominal 95% bootstrap intervals, exact two-sided sign-flip tests and Holm correction across all reported mode/metric comparisons. Use the JSON's intervals and adjusted p-values; a raw median decrease alone does not establish a performance improvement. The larger test family is why the default uses 16 blocks. Shared-runner noise still limits generalization.

## Reproduce

Install the project's pinned Bun and pnpm, then install frozen dependencies in both compiler checkouts. Keep the Node baseline disposable:

```sh
git worktree add --detach /tmp/compiler-node-baseline f2068c0d8ab86c80706fa59867e127101fa51fae
pnpm --dir /tmp/compiler-node-baseline/prototypes/chess-compiler install --frozen-lockfile
pnpm --dir compiler install --frozen-lockfile
python3 compiler/evaluation/execution_modes.py \
  /tmp/compiler-node-baseline/prototypes/chess-compiler \
  compiler report/execution-modes
```

`CHESS_NODE` and `CHESS_BUN` select explicit runtime paths; `CHESS_RUNTIME_BLOCKS` accepts 3–16 blocks (small runs are smoke checks). Node SEA generation uses pinned `postject@1.0.0-alpha.6` through pnpm. The dedicated GitHub workflow runs this matrix on harness PR changes or manual dispatch, and uploads reports rather than large generated binaries. Normal quality checks exercise the comparison guards with `--self-test`.

## Local measured results, 3 November 2026

A 16-block run completed on Linux x64 with Node 24.22.1 and Bun 1.4.4. All ten available artifacts passed the acceptance evaluations and work budgets; native AOT was unavailable through the documented command. The source controls are Node-era `f2068c0` and current Bun-era `1686d2b`. This run preceded the environment/timeout-report hardening, with the cache-disable variable absent and an actual Node cache file present. Those fixes do not alter compiler or timing bodies.

| Mode | First compilation median ms | Warm initial build, 100 stories median ms |
| --- | --: | --: |
| Node + tsx | 691.84 | 27.14 |
| Node bundle | 179.67 | 28.72 |
| Node bundle + populated cache | 149.50 | 26.57 |
| Node SEA | 161.21 | 27.13 |
| Node SEA + code cache | 143.62 | 26.75 |
| Historical compiler on Bun source | 135.61 | 33.20 |
| Current Bun source | 133.39 | 33.79 |
| Current Bun bundle | 103.82 | 35.00 |
| Current Bun executable | 100.85 | 33.80 |
| Current Bun executable + bytecode | 41.97 | 33.33 |

Every startup comparison against its revision's source control was detectable after Holm correction across 104 mode/metric comparisons (adjusted p = 0.00317). For current Bun, the paired ratios and nominal 95% intervals were 0.71 [0.64, 0.78] for the bundle, 0.71 [0.66, 0.76] for the executable, and 0.29 [0.27, 0.32] for the bytecode executable. These are geometric means of paired ratios, not quotients of the displayed aggregate medians.

None of the current Bun delivery modes had a detectable difference for the 100-story warm initial build. Bytecode did improve the one-story warm initial case in this run (paired ratio 0.83). The broader matrix has other detectable small-workload effects, so this is not a claim that packaging can only affect startup. The strongest demonstrated benefit is first compilation; bundling already captures much of the Node/tsx difference, before adding a single-executable container.

The current Bun executable was about 105.5 MiB and its bytecode counterpart 107.5 MiB. Node SEA artifacts were about 122.6–123.0 MiB; bundles were about 1.5 MiB and require their runtime separately. All figures describe these benchmark artifacts, not minimal release builds. This experiment does not change normal project execution to packaged binaries.

## Go counterpart

When `CHESS_GO_MODULE` points to the experimental branch module and Go is installed (or selected with `CHESS_GO`), the suite builds that module with `CGO_ENABLED=0 go build -trimpath` and adds `go-native`. Its public API is exercised by the unchanged acceptance harness through an untimed adapter, plus the generated/full-snapshot differential suite. Diagnostic prose is implementation-specific; evaluation comparison retains codes, phases, severities and UTF-16 spans. Native timing runs inside the Go worker without IPC and receives the maintained fixture factory's exact source maps. Go source/dependency/binary identities and toolchain version are recorded separately.

Use `CHESS_MODE_ARMS=bun-source,bun-bytecode,go-native` for the focused comparison. The source control for every selected revision is retained automatically. Default selection still includes all available modes. This is a comparison of compiler implementations, libraries and delivery modes, rather than an isolated runtime effect. Inherited `GOGC`, `GOMEMLIMIT` and `GOMAXPROCS` tuning is removed; Go defaults remain in force.

On the experimental branch, the dedicated Go workflow checks generation, formatting, vet, race tests and bounded fuzzing before the 16-block comparison. The compiler's [conformance profile](https://github.com/phibkro/chess-anthology/blob/experimental/go-compiler/prototypes/chess-compiler-go/README.md) makes its supported operations and remaining limits explicit.

### Go prototype measurement, 3 November 2026

The final local 16-block comparison passed the shared acceptance corpus/work budgets and 594 differential cases. Node/Bun package controls retain their previous scope; this focused run compares the current Bun compiler with the Go implementation, including Fastbelt, chess-on-go, WHATWG resolution and defensive DTO ownership.

| Operation | Bun source median ms | Go native median ms | Paired Go/Bun ratio [95% interval] |
| --- | --: | --: | --- |
| Launch + one-story first compile | 151.89 | 14.20 | 0.10 [0.09, 0.11] |
| Initial build, 100 stories | 39.14 | 8.78 | 0.23 [0.22, 0.25] |
| Unchanged, 100 stories | 0.39 | 3.40 | 9.47 [8.41, 10.75] |
| Prose edit, 100 stories | 1.60 | 3.92 | 2.47 [2.22, 2.76] |
| Shared-game edit, 100 stories | 21.65 | 5.84 | 0.29 [0.27, 0.31] |

All five displayed Go comparisons were detectable after Holm correction across 26 mode/metric comparisons (adjusted p = 0.000793). Ratios are paired geometric means, not quotients of aggregate medians. These are observations on one Linux x64 environment, not universal language rankings.

Bun's bytecode executable measured 48.18 ms for first compilation and 38.26 ms for the 100-story initial build; the native Go artifact was 6.18 MiB versus 107.47 MiB for that Bun artifact. The Go first-compilation worker streams only the one-story case, avoiding unrelated full-matrix fixture loading. Each warm sample receives the exact revision-specific source map generated for the corresponding TypeScript sample; there is no IPC in native timings.

The larger unchanged/prose regression is consistent with Go's snapshot-copy strategy, which serializes and reconstructs the full DTO before returning it. That is a code-level cost hypothesis, not an allocation profile or isolated causal experiment. Consider immutable handles or more selective defensive copying in a later measured revision, while retaining ownership tests.

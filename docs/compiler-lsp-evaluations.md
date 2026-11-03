# Editor protocol evaluations

Current layout: the supported Bun module lives in `compiler/`. Go implementation and Go-specific CI are retained on [experimental/go-compiler](https://github.com/phibkro/chess-anthology/tree/experimental/go-compiler). Historical measurements below refer to their recorded revisions. To include Go in a new experiment, supply its separate module checkout via `CHESS_GO_MODULE` (execution modes) or `--go-module` (LSP). Default LSP experiments exercise Bun delivery modes only; `--arms all` also includes installed historical Node controls and includes Go only when its module is supplied.

The compiler's public snapshots and source metadata form the editor adapter boundary. Go's `cmd/chess-lsp` uses the pinned `golang.org/x/exp/jsonrpc2` transport (Content-Length framing, serialized requests and cancellation) and `typefox.dev/lsp` protocol types. Langium supplies the TypeScript server. Neither server exposes its parser AST through the compiler API.

| Layer | Contract | Evaluation |
| --- | --- | --- |
| Text synchronization | UTF-16 incremental/full edits, open buffers override disk | Non-BMP text, CRLF, edit/recovery and PGN overlay/close |
| Compiler feedback | Diagnostic code, severity, source range and document version | Valid imports, syntax errors, illegal answers, external PGN invalidation |
| Editor queries | Legal SAN completion plus replacement range; imported game definition | Assert returned move/UCI and definition URI |
| Resource lifecycle | Watch changes, dependency rebuilds, deletion clears diagnostics | Create/delete/recreate module; invalid PGN then recovery |
| Transport lifecycle | Framed JSON-RPC, cancellation, shutdown/exit | Fragmented initialize, cancellation race followed by healthy request, exit with client stdin still open |
| Cache ownership | Editor queries cannot mutate compiler state | Owned source metadata; separate defensive snapshots |

Go advertises only implemented features: UTF-16 incremental synchronization, completion and definitions. It registers narrative/PGN file watches when the client supports dynamic registration. Go caches dependency paths by exact narrative source text; unchanged documents are not reparsed during resource acquisition. Watch notifications and buffer events refresh affected sources before the incremental compiler update. File sources use local `file:` URIs; remote source providers, workspace-folder changes, rename/hover/semantic tokens and a complete grammar completion provider remain outside this prototype. Completion currently offers legal SAN within parsed prompt answers. The cancellation evaluation permits either a completed response or the standard cancellation error, because completion may win the cancellation race; it checks subsequent server health rather than claiming bounded cancellation latency.

The maintained Bun server now acquires PGN dependencies, honors unsaved PGN buffers, restores disk sources on close, and rebuilds dependent narrative documents on artifact changes. Its asynchronous source cache discards superseded disk reads and cannot erase a newer unsaved buffer after a failed read. Dedicated deferred-read tests exercise those races.

## Run

From the repository root with pinned Bun and Go on PATH:

```sh
# Fast maintained Bun protocol gate (included in check:all)
pnpm check:lsp

# Supported Bun delivery modes, acceptance only
python3 compiler/evaluation/lsp_compare.py --eval-only

# All delivery modes, including a frozen installed Node-era checkout
python3 compiler/evaluation/lsp_compare.py \
  --arms all --node-baseline /absolute/path/to/node-checkout \
  --blocks 16 --iterations 5 --sizes 1,10,100 --output report/lsp

# Editor launch command
git worktree add /tmp/chess-go experimental/go-compiler
go -C /tmp/chess-go/prototypes/chess-compiler-go run ./cmd/chess-lsp
```

The historical checkout must be at `f2068c0d8ab86c80706fa59867e127101fa51fae`, with its compiler lockfile dependencies installed by pnpm. CI creates that checkout explicitly. `--arms all` covers Bun source, bundle, executable and bytecode executable; Go native; Node/tsx, Node bundle, Node SEA with/without code cache; and historical source under Bun as a same-code runtime control. Bun executable builds package JavaScriptCore and are not native AOT compilation. Native AOT remains unavailable in the pinned runtime, as recorded by the separate execution-mode capability probe.

## Measurement and interpretation

Every arm first runs common and extended acceptance sessions over the actual LSP wire. A maintained arm must pass both profiles. Historical arms must pass the common profile; extended failures are recorded as feature gaps. Historical Langium does not publish document versions, does not invalidate lessons when PGN files change, and can exit when a PGN buffer is opened. It is timed only on the common sequential editing profile, with one outstanding edit at a time. These are frozen implementation comparisons, not proof of a language or runtime effect.

The harness builds artifacts before timing and records build logs/cost, artifact bytes/digests, revisions, runtime versions, source digest and dirty state. Process launch, JSON serialization, pipe traffic, filesystem acquisition and matching diagnostic receipt are included. First diagnostics measures launch through usable lesson feedback; initialize time alone is not comparable because Go discovers files during initialize while Langium discovers them later. OS caches are not flushed: these are fresh processes with naturally warm filesystem caches, not cold-machine measurements.

Each seeded paired block runs every arm in rotated order. Each workspace size uses a fresh server. The statistical unit is that process's median of five actual edits/queries, rather than treating each request as an independent experiment. Reports retain raw samples, schedules and protocol transcripts. Comparisons against Bun source use paired log ratios, bootstrap confidence intervals, exact sign-flip tests and Holm correction across the reported comparisons. Timing is descriptive, never a blocking speed threshold. Acceptance is blocking.

PGN change/recovery timing is present only for maintained arms that support it. Its range includes the two notifications, diagnostic delivery, and request fences. Before each external-change transition, an ordered query flushes prior wire output and old queued diagnostics for the target are discarded. An injected stale clean publication verifies that old diagnostics cannot satisfy the recovery wait. This matters because an external PGN change does not increment a narrative document's editor version.

The synthetic corpus contains 1, 10 or 100 narrative stories sharing one imported game library, with identical initial board positions and prompt moves. This isolates workspace scaling; it does not establish behavior for huge PGN databases, broad dependency graphs, long games or Chess960 editor interactions. The existing compiler conformance corpus remains a separate requirement.

The `LSP evaluations and benchmarks` workflow runs all modes and uploads `lsp-evaluations-and-benchmarks`, including acceptance results/transcripts, samples, builds and inference. The standard quality workflow also runs the fast maintained Bun protocol gate.

## Recorded results

The [3 November 2026 run](research/lsp-benchmarks-2026-11-03.md) records all ten modes, with raw process medians and corrected comparisons. It exposed redundant full-workspace dependency parsing in the first Go adapter; dependency discovery now caches exact source text before the recorded final comparison.

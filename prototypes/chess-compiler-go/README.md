# Go chess compiler prototype

This is an independent implementation of the current narrative compiler's public data contracts. It uses **Fastbelt** for generated syntax and **chess-on-go** for chess rules. Parsing, local semantics, linking, game analysis, emission and incremental builds remain explicit internal package boundaries. The TypeScript/Bun implementation remains the application default.

| Boundary | Implementation |
| --- | --- |
| `contracts/` | Plain authored documents, histories, diagnostics, playback, snapshots and Result DTOs; no parser/chess dependency |
| `internal/phases/100-parsing/` | Pinned Fastbelt grammar/generated code; raw string lowering and UTF-16 spans |
| `200-semantic-analysis/` | Strict structured shape checks, identifiers, safe integers and local identities |
| `300-linking/` | Explicit import/export visibility, URI resolution and cycle detection |
| `400-chess-analysis/` | Source-retaining PGN token/variation traversal, standard/Chess960 legality, normalized FEN/SAN/UCI |
| `500-emission/` | Canonical narrative printer, exact source envelope, occurrence DTOs and playback target |
| `600-build/` | Source diffs, transitive invalidation, replay reuse, revisions and snapshot ownership |
| `compiler.go` | Public compiler/codec/history/playback entry point |
| `cmd/chess-compiler/` | JSON-lines adapter and native benchmark worker |

Fastbelt is pinned to `v0.1.1-0.20261026125838-e6491141491b`; chess-on-go to `v0.22.2`. Generation is pinned through Go's `tool` directive. URI resolution uses `github.com/nationallibraryofnorway/whatwg-url` v0.7.0 to match JavaScript WHATWG URL behavior, including encoded dot segments. See the [tooling audit](../../docs/research/go-compiler-tooling.md) for alternatives and the executable spike that led to adopting Fastbelt. Its linking/workspace/LSP lifecycle is not adopted wholesale: PGNs are dependency edges outside the syntax framework, and our write/snapshot contract differs from its default lifecycle.

## Supported contract

- Version-0 authored documents, narrative source grammar, canonical printing and unchanged-source restoration. Unknown structured fields, missing fields, null arrays, reserved identifiers, unsafe anchors and negative-zero anchors are rejected.
- `contracts.Text` preserves JavaScript UTF-16 semantics, including escaped lone surrogates, through a WTF-8 internal representation and custom JSON codec. Hashing replaces lone surrogates exactly as JavaScript TextEncoder does. Do not replace it with ordinary `encoding/json` string decoding. Go callers should obtain arbitrary text through this codec; arbitrary malformed UTF-8 byte strings are not JavaScript text values.
- Ordered stories/scenes/annotations, module visibility, cycles, source availability, source-ranged phase diagnostics, legal histories and playback prompts. Parser/error prose may differ; code, responsible phase, severity and UTF-16 token ranges are checked against the acceptance fixtures. Optional schema-error paths are not currently reproduced exactly.
- Standard chess and Chess960, including reduced-material setups, explicit setup errors, all 960 initial arrays, and both sides' castling geometries. FEN normalizes uncapturable en-passant targets and outer-rook rights to the current chessops convention; castling UCI identifies the entitled rook. We own variation traversal instead of using the library's lossy PGN loader. Original PGN text remains in the source set; this is not a new canonical PGN exporter.
- Incremental replay/work budgets and retained snapshots. `UpdateOrdered` / `CompileOrdered` preserve configured source order like the TypeScript Map API. Map-based convenience calls sort URIs deterministically. Public snapshots and read views are defensive copies: callers cannot alter compiler state or another retained revision through returned slices/pointers. Overlapping writes return `build/busy`.

Go DTO ownership has a cost: this prototype deep-copies returned snapshots through the lossless JSON codec, including unchanged updates. The first measured run showed faster initial/shared-game builds but slower larger unchanged/prose operations than Bun. This is a whole-implementation comparison, including parser/rules library and ownership strategy; it is not evidence that one language is inherently faster.

The current prototype does not implement EPD/database imports, external FEN linking, a complete-initial-array declaration validator, or canonical PGN export/loss reports. The latter format features are also pending in the TypeScript prototype. The source envelope preserves unchanged source; it does not promise trivia-preserving edits to arbitrary PGN extensions. PGN variations are bounded at depth 256. Non-move text is skipped using the current chessops-style lexical convention; invalid _recognized_ moves in any branch are rejected.

## Build and checks

Use Go **1.27.3**. No C toolchain is needed for the compiler executable; race checks use Go's normal race-toolchain requirements.

```sh
cd prototypes/chess-compiler-go
go mod download
go mod verify
go generate ./...
go test ./...
go vet ./...
go test -race ./...
go test ./contracts -fuzz=FuzzText -fuzztime=10s
go test . -fuzz=FuzzDecode -fuzztime=10s
go test . -fuzz=FuzzPGN -fuzztime=10s
CGO_ENABLED=0 go build -trimpath -o ../../report/chess-compiler-go ./cmd/chess-compiler
```

From the repository root, run differential checks and the shared benchmark suite:

```sh
python3 prototypes/chess-compiler/evaluation/go_conformance.py \
  prototypes/chess-compiler report/chess-compiler-go report/go-conformance
CHESS_MODE_ARMS=bun-source,bun-bytecode,go-native \
  python3 prototypes/chess-compiler/evaluation/execution_modes.py \
  prototypes/chess-compiler prototypes/chess-compiler report/go-comparison
```

`CHESS_GO` / `CHESS_BUN` select explicit toolchain paths. The shared acceptance harness invokes Go through an untimed adapter. Native benchmark operations run **inside Go**, with exactly the source maps generated by the maintained TypeScript workload factory; no Bun-to-Go IPC is inside the timed interval. One fresh compiler is used per sample, with untimed initial population for incremental cases. Go's default GC settings are retained; the harness removes inherited tuning overrides.

The JSON-lines adapter accepts `compile`, `session` (a sequence of source maps), `decode`, `structured`, `print`, `envelope`, `restore`, `select` and `plan`. Sources are arrays of `{uri,text}` records so URI ordering is explicit. Results use `{ok:true,value:...}` or `{ok:false,error:{kind,code,message}}`. Requests are limited to 64 MiB by the transport, independently of the in-memory compiler API.

The existing eight acceptance cases and eight work budgets run unchanged against the Go adapter. Differential tests additionally compare generated codecs, full snapshots and ordered edit histories with TypeScript, excluding implementation-specific diagnostic prose/optional schema paths and sorting legal-move sets. Native tests cover ownership, all 960 starts, literal castling fixtures, architecture and malformed-input fuzzing. These checks establish prototype conformance for the exercised contract, not formal equivalence for every possible input.

The editor adapter is available with `go run ./cmd/chess-lsp`. It serves UTF-16 incremental synchronization, versioned compiler diagnostics, legal SAN prompt completion and imported game definitions over stdio. See [shared LSP evaluations](../../docs/compiler-lsp-evaluations.md) for editor behavior, scope and delivery-mode benchmarks.

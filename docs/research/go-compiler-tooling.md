# Go compiler-development tooling: current fit

Research date: 3 November 2026. Scope: compiler infrastructure, not another chess-library survey. The [Go counterpart report](go-chess-compiler.md) covers the rules/notation candidates. Popular-library lists are discovery aids; they do not establish source preservation, diagnostic correctness or fit for our phase contracts.

## Decision

**Reuse Fastbelt for the syntax experiment, retain our plain contracts and custom text codec, and evaluate its linking/workspace services separately.** The small handwritten parser remains a useful behavioral reference, but the newly verified Fastbelt capability changes the earlier “handwrite first” recommendation: it can remove lexer/parser/recovery machinery without requiring us to surrender our document model.

| Tool | Adopt now / investigate / defer | Reason |
| --- | --- | --- |
| Fastbelt | Use for the bounded syntax slice; investigate link/workspace integration | Langium-like grammar, generated Go parser/linker/types, positional tokens, comment collection and editor infrastructure |
| Participle v2 | Keep as the smaller fallback | Strong typed-parser ergonomics and token capture; no workspace/linking lifecycle |
| Handwritten recursive descent | Keep as reference/fallback, not the assumed final architecture | Easy control for the current tiny grammar; recovery, tooling and maintenance remain our work |
| Pigeon / PEG | Defer | Separate grammar and generated Go are useful, but do not resolve our linking or representation problems |
| ANTLR Go | Defer | Worth reconsidering for shared grammars across targets; adds generator/runtime coordination for a small language |
| Tree-sitter Go | Defer until concrete incremental-editing need | Concrete incremental trees are useful; native lifetime/ABI integration and lowering are additional work |
| Native Go fuzzing / testing / profiling | Adopt immediately | Standard toolchain, seed corpora, coverage-guided malformed-input checks and reproducible performance tools |
| Rapid | Add when structured/edit-sequence properties begin | Automatic shrinking and model-based tests are close to the role fast-check already fills |
| Gopter | Alternative, not an additional dependency | Supports custom generators/shrinkers and stateful commands; no need for two property frameworks |

These are project recommendations, not measured speed rankings.

## Source and maintenance check

Release metadata was checked against each module's Go proxy `@latest` response; implementation details were inspected in the repositories at the listed commits. A recent commit is activity evidence, not a maintenance guarantee. Release and development-head APIs must not be mixed accidentally.

| Module | Latest tagged version observed | Inspected source / minimum Go at that source | License |
| --- | --- | --- | --- |
| `typefox.dev/fastbelt` | v0.1.0, 25 June 2026 | `e649114`, 26 October 2026; Go 1.27 | MIT |
| `github.com/alecthomas/participle/v2` | v2.1.4, 24 March 2025 | `6a9cbdc`, 2 October 2026; Go 1.24 | MIT |
| `github.com/mna/pigeon` | v1.3.0, 12 September 2024 | `64e1636`, 7 October 2026; Go 1.26 | BSD-3-Clause |
| `github.com/antlr4-go/antlr/v4` | v4.13.1, 15 May 2024 | `4d7e188`, same release; Go 1.22 | BSD-3-Clause |
| `github.com/tree-sitter/go-tree-sitter` | v0.24.0, 14 October 2024 | `c949200`, 12 November 2025; Go 1.23 | MIT |
| `pgregory.net/rapid` | v1.3.0, 30 March 2026 | `6706a6f`, 4 September 2026; Go 1.23 | MPL-2.0 |
| `github.com/leanovate/gopter` | v0.2.11, 3 April 2024 | `967a500`, 20 April 2026; Go 1.20 | MIT |
| `typefox.dev/lsp` | v0.1.0, 7 July 2026 | `0028485`, same release; Go 1.26 | BSD-3-Clause |
| `go.lsp.dev/protocol` | v1.0.1, 27 June 2026 | `fd04595`, 31 August 2026; Go 1.26 | BSD-3-Clause |

Primary repositories supply their `go.mod`, license and source history: [Fastbelt](https://github.com/TypeFox/fastbelt/tree/e6491141491b16cd979b40c1714148e037af2459), [Participle](https://github.com/alecthomas/participle/tree/6a9cbdc28572aaa66f5bda570b4ad07ff0b4a4c2), [Pigeon](https://github.com/mna/pigeon/tree/64e1636a0205439b0196123bf7ab4a4fbb753d41), [ANTLR Go](https://github.com/antlr4-go/antlr/tree/4d7e18847d8881a176db3d7cca909e3f3942a05f), [Tree-sitter Go](https://github.com/tree-sitter/go-tree-sitter/tree/c9492002f76ed75037e3fe6d3bbabb54ed3e1ff5), [Rapid](https://github.com/flyingmutant/rapid/tree/6706a6fd83736ba24aaf55ef2621fdf00c2c27e8), [Gopter](https://github.com/leanovate/gopter/tree/967a5004fb702c153283a99f5a3908ee6570c066), [TypeFox LSP](https://github.com/TypeFox/go-lsp/tree/002848561d26f49b7eec0c97bec2e95f3ccb1ea2), [go.lsp.dev protocol](https://github.com/go-language-server/protocol/tree/fd045959937f0ee543549b22b4e34028e42fb0f9). For example, the [Fastbelt module release record](https://proxy.golang.org/typefox.dev/fastbelt/@latest) is separate from its inspected October source.

## Fastbelt: actual reusable machinery

Fastbelt generates lexer, parser, AST accessors and linking services from `.fb` grammars. Its workspace provides document storage, phase-state reset, reference-impact analysis, validation, cancellation and read/write coordination. Its text-document utilities map byte offsets to UTF-16 positions. These are source-verified features, not capabilities inferred from a toolkit label. [README](https://github.com/TypeFox/fastbelt/blob/e6491141491b16cd979b40c1714148e037af2459/README.md), [workspace lifecycle](https://github.com/TypeFox/fastbelt/blob/e6491141491b16cd979b40c1714148e037af2459/workspace/doc.go), [builder](https://github.com/TypeFox/fastbelt/blob/e6491141491b16cd979b40c1714148e037af2459/workspace/builder.go), [position mapping](https://github.com/TypeFox/fastbelt/blob/e6491141491b16cd979b40c1714148e037af2459/textdoc/file.go)

The raw-token behavior is particularly useful. `Token.Image` is the original lexeme; generated string accessors return that image rather than calling `strconv.Unquote`. Lower the token through our custom `contracts.Text` JSON-string decoder, preserving lone UTF-16 surrogates. Do not serialize generated framework ASTs as our authored document contract. [Token model](https://github.com/TypeFox/fastbelt/blob/e6491141491b16cd979b40c1714148e037af2459/token.go), [generated accessor example](https://github.com/TypeFox/fastbelt/blob/e6491141491b16cd979b40c1714148e037af2459/examples/statemachine/types_gen.go)

### A verified minimal syntax slice

This deliberately covers module/game declarations only, not the whole narrative grammar:

```text
grammar Narrative
interface Module { Name string Games []Game }
entry Module returns Module:
    "module" Name=ID ";" Games+=Game*
interface Game { Name string Source string }
Game returns Game:
    "game" Name=ID "from" Source=STRING ";"
token ID: /[_a-zA-Z][_a-zA-Z0-9]*/
token STRING: /"([^"\\\x00-\x1F]|\\(["\\\/bfnrt]|u[0-9a-fA-F]{4}))*"/
hidden token WS: /\s+/
comment token SL_COMMENT: /\/\/[^\n\r]*/
```

Pin the inspected commit for these exact APIs instead of assuming June's v0.1.0 is identical:

```sh
go run typefox.dev/fastbelt/cmd/fastbelt@e6491141491b16cd979b40c1714148e037af2459 generate narrative.fb -o generated
```

The generated package exposes `SetupGeneratedServices`. A parse-only adapter can use:

```go
sc := service.NewContainer()
generated.SetupGeneratedServices(sc)
sc.Seal()
doc := fastbelt.NewDocumentFromString(uri, "narrative", source)
service.MustGet[lexer.Lexer](sc).Exec(doc)
service.MustGet[parser.Parser](sc).Parse(doc)
// Check doc.LexerErrors and doc.ParserErrors before lowering doc.Root.
```

Imports are `typefox.dev/fastbelt`, `/lexer`, `/parser`, `/util/service`, and the generated package. Workspace/linking/server defaults are additional setup, not implied by this parse-only snippet. The [generated services example](https://github.com/TypeFox/fastbelt/blob/e6491141491b16cd979b40c1714148e037af2459/examples/statemachine/services_gen.go) shows the actual registration API.

A scratch Go 1.27.3 spike generated and compiled that grammar. Parsing `module demo; game study from "\ud800.pgn"; // retained comment` returned zero lexer errors, zero parser errors, one collected comment, and the exact quoted string lexeme `"\ud800.pgn"`; its token byte range was `[29, 41)`. This verifies a useful codec seam, not whole-language or workspace equivalence.

### What must stay ours

Fastbelt's document graph is mutable infrastructure. Lower it into our plain IR and publish independently immutable history/build snapshots. Its default lifecycle cancels superseded writes; that differs from our explicit busy/update/error contract. Its reference-based impact calculation must be extended for PGN/source edges that are not AST references. Imports/exports must obey our visibility policy rather than accepting a framework's default global symbol visibility. [Update and impact services](https://github.com/TypeFox/fastbelt/blob/e6491141491b16cd979b40c1714148e037af2459/workspace/document_updater.go), [symbol export](https://github.com/TypeFox/fastbelt/blob/e6491141491b16cd979b40c1714148e037af2459/linking/exported_symbols.go)

The framework's comment stream plus original source is adequate for untouched-source envelopes; it does not establish a lossless semantic-editing codec. Its UTF-16 mapping assumes decoding source text as UTF-8, so test non-BMP characters, CRLF and any raw WTF-8 input accepted by our programmatic API separately from escaped JSON surrogates. The publisher's state-machine benchmarks are useful leads, not evidence of speedups on our chess workload. [TypeFox's benchmark description](https://www.typefox.io/blog/fastbelt-introduction/)

Adoption gate: translate the complete grammar, lower string tokens through `Text`, pass the shared corpus/roundtrips, preserve diagnostic spans, then prove custom PGN invalidation and old-snapshot stability. Keep linking/workspace/LSP adoption separate if those gates fail.

## Why the other parser options remain alternatives

**Participle v2** supports typed productions, custom `Capture`, positional fields, partial ASTs on error, and capture of elided tokens. That is a credible smaller parser dependency. However, its default scanner transforms Go-style quoted strings using `strconv.Unquote`, and the optional `Unquote` mapper also uses Go escape rules. Neither is our JSON/JavaScript string contract: use a custom lexer and raw-token capture into `Text`. Retained tokens need position-aware handling for comments rather than assuming AST reconstruction preserves layout. [Scanner transform](https://github.com/alecthomas/participle/blob/6a9cbdc28572aaa66f5bda570b4ad07ff0b4a4c2/struct.go), [unquote mapper](https://github.com/alecthomas/participle/blob/6a9cbdc28572aaa66f5bda570b4ad07ff0b4a4c2/map.go), [positions/comments](https://github.com/alecthomas/participle#comments)

**Pigeon** generates Go from a PEG grammar; generated parsing is based on UTF-8 source and semantic actions can return our types. It is attractive if a standalone declarative grammar is the main goal. Packrat/memoization choices, recovery and actions need workload evaluation, and a generated parser still supplies no import/link/build service. Its current development branch raises the minimum toolchain beyond the older release. [Pigeon usage and release policy](https://github.com/mna/pigeon/blob/64e1636a0205439b0196123bf7ab4a4fbb753d41/README.md)

**ANTLR** supplies a generated Go target, token channels, parse trees and customizable error listeners/strategies. Preserve trivia on channels instead of skipping it when a source-aware view is needed. Tool/runtime versions must be coordinated; generation adds the ANTLR tool dependency. Defer unless cross-language grammar sharing or substantially richer recovery justifies it. [Official Go target](https://github.com/antlr/antlr4/blob/master/doc/go-target.md), [runtime source](https://github.com/antlr4-go/antlr)

**Tree-sitter Go** genuinely supports incremental concrete trees. The inspected official binding still imports `C`, and its documentation requires explicit `Close` for native objects; a `purego` grammar-loading example does not make the parser a pure-Go runtime. Tree-sitter-go, the Go-language grammar, is also a different package from go-tree-sitter, the bindings needed for our language. Defer until measured per-edit parsing costs justify a native syntax subsystem. [Binding source](https://github.com/tree-sitter/go-tree-sitter/blob/c9492002f76ed75037e3fe6d3bbabb54ed3e1ff5/parser.go), [lifetime guidance](https://github.com/tree-sitter/go-tree-sitter/blob/c9492002f76ed75037e3fe6d3bbabb54ed3e1ff5/README.md)

## Diagnostics, LSP and verification

Keep our diagnostic records framework-free: stable code/phase/path plus zero-based UTF-16 ranges with exclusive ends. Initially a small `fmt`-based CLI renderer is sufficient. Do not introduce a terminal styling dependency as a substitute for useful diagnostic content.

When using Fastbelt, reuse its server and its existing `typefox.dev/lsp` dependency rather than carrying two LSP type systems. Without Fastbelt, `go.lsp.dev/protocol` v1.0.1 is a current alternative with generated unions and RPC support; the old v0.12.0 documentation is not a reliable description of its present API. Do not import `gopls/internal` packages. LSP type libraries do not implement our analysis, source overlays, URI resolution or snapshot policy for us. [TypeFox LSP](https://github.com/TypeFox/go-lsp/tree/002848561d26f49b7eec0c97bec2e95f3ccb1ea2), [current protocol source](https://github.com/go-language-server/protocol/tree/fd045959937f0ee543549b22b4e34028e42fb0f9), [LSP position rules](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.18/specification/#position)

Use native `testing.F` now for malformed bytes, string tokens, roundtrips and minimized regression seeds. Add **Rapid** for structured document generators and state-machine edit sequences; its automatic shrinking and persisted failures reduce test infrastructure. Its canonical import is `pgregory.net/rapid`, and its MPL-2.0 license is a distinct dependency choice worth recording. **Gopter** offers custom generators/shrinkers and stateful commands under MIT, but adding both would duplicate the same role. Neither library proves correctness without independent expectations. [Native fuzzing](https://go.dev/doc/security/fuzz/), [Rapid](https://github.com/flyingmutant/rapid/tree/6706a6fd83736ba24aaf55ef2621fdf00c2c27e8), [Gopter](https://github.com/leanovate/gopter/tree/967a5004fb702c153283a99f5a3908ee6570c066)

Use `gofmt`, `go vet`, table-driven conformance tests and `go test -race` as the first Go checks. For profiling, `testing.B.Loop`, allocation reporting and `pprof` are sufficient initially. `benchstat` helps compare repeated Go microbenchmarks; the cross-runtime PR comparison must still use shared workload definitions, balanced fresh processes, raw samples and comparable boundaries. A faster parser does not establish a faster compiler if replay, linking or snapshot copies dominate. [Benchmark loop](https://go.dev/blog/testing-b-loop), [benchstat](https://pkg.go.dev/golang.org/x/perf/cmd/benchstat), [Go diagnostics tools](https://go.dev/doc/diagnostics)

## Source URI resolution: reuse WHATWG behavior

Adopt **`github.com/nationallibraryofnorway/whatwg-url` v0.7.0**, pinned behind our own source-resolution boundary. The TypeScript compiler uses JavaScript `new URL(reference, base)`: Go's `net/url.ResolveReference` is not an equivalent replacement. WHATWG parsing recognizes percent-encoded dot segments and normalizes special-scheme backslashes; adding a private encoded-dot patch would leave other differences unresolved. Do not unescape the entire path before resolving: encoded slashes must remain encoded. [WHATWG URL parsing](https://url.spec.whatwg.org/#url-parsing), [Go URL resolution contract](https://pkg.go.dev/net/url#URL.ResolveReference)

```go
import whatwg "github.com/nationallibraryofnorway/whatwg-url/url"

resolved, err := whatwg.ParseRef(baseURI, reference)
if err != nil {
    // Return a compiler diagnostic value.
}
canonicalURI := resolved.Href(false) // false keeps the fragment
```

The argument order is **base, reference**. A previously parsed base also offers `base.Parse(reference)`. These entry points and `Href(false)` were source-inspected and executed for v0.7.0; use the ordinary parser, without optional canonicalizer profiles that add normalization beyond JavaScript's `.href`. [Pinned API](https://pkg.go.dev/github.com/nationallibraryofnorway/whatwg-url@v0.7.0/url#ParseRef)

| Dependency evidence | Verified result |
| --- | --- |
| Release and source | v0.7.0, 19 January 2026; commit `0c3b19565226a26c151d721319130f402d48cb7f`, downloaded from Go's module proxy |
| License and minimum toolchain | Apache-2.0; Go 1.24.0 |
| Declared upstream test snapshot | README identifies Web Platform Tests from 16 January 2026; this is not proof of conformity to every subsequent standard change |
| Maintenance visibility | The release source is available through the module proxy. Direct GitHub access and the repository API returned unavailable/404 during this audit, so current live-repository maintenance could not be verified |
| Legacy alternative | Public `github.com/nlnwa/whatwg-url` v0.6.2 has the same minimal API, Apache-2.0 and Go 1.16 minimum, but an older declared WPT snapshot |

[Release metadata](https://proxy.golang.org/github.com/nationallibraryofnorway/whatwg-url/@v/v0.7.0.info), [module requirements](https://proxy.golang.org/github.com/nationallibraryofnorway/whatwg-url/@v/v0.7.0.mod), [pinned source archive including license/tests](https://proxy.golang.org/github.com/nationallibraryofnorway/whatwg-url/@v/v0.7.0.zip), [legacy parser source](https://github.com/nlnwa/whatwg-url/blob/605b909fe66d0472311892f4feed6b4de3e2bdb8/url/parser.go)

A scratch probe compared Node's `new URL(...).href` with both library versions on ten file-URL cases. Both matched all ten, including four mixed-case encoded-dot forms, backslash parents, spaces, query/fragment retention, an encoded slash, localhost and a Windows drive. Representative results, with base `file:///root/stories/story.chess-story` unless specified:

| Reference | WHATWG / Node result | `net/url` agreement |
| --- | --- | --- |
| `./%2e%2e/lib.pgn` | `file:///root/lib.pgn` | Differs |
| `./.%2E/lib.pgn` | `file:///root/lib.pgn` | Differs |
| `..\lib.pgn` | `file:///root/lib.pgn` | Differs |
| `./%2e%2e%2flib.pgn` | `file:///root/stories/%2e%2e%2flib.pgn` | Matches |
| `../lib.pgn` with a `file://localhost/root/stories/story.chess-story` base | `file:///root/lib.pgn` | Differs |

The v0.7.0 upstream `url` and `internal` test packages also passed locally. These are bounded compatibility checks, not full compiler parity or a general security review. Add the cases to our own import/link contract suite. Keep canonical URI identity separate from reading a filesystem path, and keep query/fragment treatment consistent with the existing compiler. Our custom JavaScript-string representation must apply an explicit USV-string conversion at this boundary; lone-surrogate URL inputs need their own parity tests rather than relying on Go string decoding. The verified newer release is preferable to a private compatibility shim; retain v0.6.2 only as an explicit fallback if dependency provenance policy requires a presently public repository.

The next useful experiment remains **Fastbelt syntax → existing plain authored IR → existing chess/codec contracts**, with no broad editor feature expansion until corpus parity passes.

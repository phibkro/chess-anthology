# Compiler source resolution

The Bun compiler now separates acquisition from linking. Build and editor adapters resolve imports into a complete URI-to-text map; the compiler kernel still performs dependency invalidation, linking, chess analysis and emission without fetching resources.

## Authoring

Put `chess.sources.json` in the project source directory:

```json
{
  "version": 1,
  "providers": [
    { "id": "archive", "kind": "directory", "path": "./archive/" },
    {
      "id": "database",
      "kind": "http",
      "url": "https://example.org/games/{id}.pgn"
    }
  ]
}
```

HTTP configuration describes a PGN endpoint template, not a search API. `{id}` is encoded as one URL component. The example endpoint is illustrative. No service credentials or database subscription are bundled. Directory-provider IDs name files, including their extension.

```text
module library;
export game local from "./opera.pgn";
export game archived from "chessdb://archive/opera.pgn";
export game remote from "chessdb://database/12345";
export game selected from "chessdb://database/export#game=2";
```

| Reference | Resolution |
| --- | --- |
| `./opera.pgn`, `../games/opera.pgn`, absolute `file:` URI | Live file or editor overlay; missing files fail without provider fallback |
| `opera.pgn` | Live relative file first; otherwise established lock; otherwise configured providers |
| `chessdb://database/12345` | Established lock or the named provider only |
| `sha256:…` | Exact verified local blob; no name discovery |

Unqualified discovery tries directory providers before HTTP providers, preserving configured order within each group. The first provider containing the requested record wins. HTTP 404 means absent; other HTTP errors stop resolution. This is ordered record lookup, not fuzzy historical-game matching. A lock fixes an established provider resolution until an explicit update. A catalog hit only shortcuts the corresponding provider; it cannot skip a higher-priority directory during new discovery.

Project-relative paths and import keys survive moving the project directory. Game aliases and line numbers do not participate in acquisition identity. Configured sources, their order and selector fragments do participate. Explicit relative files stay live even if an older bare-name resolution exists at that URI.

## Storage and identities

| File | Purpose |
| --- | --- |
| `.chess-cache/blobs/sha256/<digest>` | Immutable exact acquired or derived bytes, verified on reads |
| `.chess-cache/catalog/<key-digest>.json` | Config-scoped provider record to blob/provenance mapping |
| `chess.sources.lock.json` | External resolutions, original and selected digests, source locations and provider configuration digest |
| `chess.edition.json` | Exact active inputs and resolutions used for a publication |

Commit configuration, lockfiles and publication manifests. The cache is ignored by Git; retain or transfer it separately when the remote cannot reproduce old records. A lockfile provides identity, not availability. This change does not implement cache garbage collection or redistribution policy.

A record's byte digest is not its historical-game identity. Different annotations, tags or moves produce distinct blobs. We do not automatically merge conflicting records or declare them semantically equivalent.

`#game=N` selects a one-based game ordinal using chessops. The original export is retained exactly; the selected game is serialized as a separate canonical PGN. Its representation follows the pinned chessops version. An unrelated game correction can change the original export digest without changing the selected digest or rebuilding dependent stories. Locks verify both identities when recovering missing selected blobs, and recovery can use the retained original export offline. Remote changes that reorder games require reviewing an explicit update; stable provider game IDs are preferable to ordinal selectors.

## Build commands

From `compiler`:

```sh
# Acquire missing records; reuse existing external resolutions.
bun run compile /path/to/project

# Refresh provider resolutions and print old/new selected digests to stderr.
bun run compile /path/to/project --update-sources

# Record exact local inputs and external resolutions for publication.
bun run compile /path/to/project --write-manifest

# Verify the edition without changing its lock or manifest; prohibit network access.
bun run compile /path/to/project --frozen --offline
```

Frozen builds reject missing external resolutions, configuration changes, or changed input bytes/provenance. They may restore missing cache blobs only when their acquired bytes match the locked identity. A provider returning a new version cannot silently replace locked content. Updating provider configuration requires `--update-sources`. Updating a lock does not update an edition unless `--write-manifest` is also supplied.

Metadata is published after acquisition and the compiler update succeed. Semantic source diagnostics remain compiler output; the CLI exits unsuccessfully when diagnostics contain errors. Writes use temporary files and atomic renames. One project-compiler instance rejects overlapping updates; editor metadata publication is serialized. Run one metadata-writing process per source root. Cross-process transactions and locking are not implemented.

## Programmatic and editor use

`@chess-anthology/compiler/sources` exports `createProjectCompiler`, `loadProjectSources`, `openResolver` and configuration/lock/manifest types. A project compiler preserves the existing in-memory analysis and syntax state between updates. It reopens persistent resolutions each update, so an explicit source update naturally invalidates dependent modules through changed resolved bytes. Acquisition failures leave the previous compiler snapshot intact.

The source directory's top-level `.chess-story` and `.pgn` files are default entries; module imports and game sources are followed recursively. Supply `entries` for a narrower publication closure. Invalid narrative syntax is reported by the compiler; the acquisition pass does not guess dependencies from invalid syntax.

The Bun LSP uses the first initialized workspace folder as its source root. `CHESS_SOURCE_ROOT` overrides it. Existing PGN overlays and file watches remain authoritative. Config/provider changes require restarting the server; use the CLI for explicit refresh and publication. Multiple independent source roots in one server are not supported yet. Remote acquisition failures currently surface as unavailable-source diagnostics. Unchanged remote records reuse locked blobs; dependency discovery and local reads are separate from replay caching.

Chess replay remains cached by content within a compiler session, with bounded inactive revisions and protected active inputs. Persisted engine-position analysis and semantic game deduplication remain future work.

## Verification

`src/sources/sources.test.ts` covers fresh-process HTTP acquisition and frozen offline reuse; cache/catalog reuse; live files and buffers; provider precedence; changed locked content; multi-game selection; byte integrity; edition mismatch; configuration changes; and overlapping project updates. Existing compiler conformance and LSP acceptance suites remain required.

Project updates report `acquisition.parsedNarratives` separately from kernel work; unchanged narrative dependency discovery is reused across project updates.

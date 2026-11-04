# Markdown authoring and declarative configuration

Status: implemented on the Markdown authoring branch. TypeScript configuration is deferred.

## Representations and contracts

| Representation | Contract | Purpose |
| --- | --- | --- |
| `.chess-story` | Existing brace language; authored JSON version 0 | Compatible programmatic/legacy source |
| `.chess.md` | YAML frontmatter, CommonMark, chess directives | Prose-oriented source |
| Structured authoring | JSON AST version 1, validated by Valibot | Metadata, unresolved bindings, story/scene identities and rich Markdown nodes |
| Source envelope | Authoring AST, original source and verified digest | Exact restoration of untouched source, including comments |
| Playback | Version 3 for rich stories; versions 1/2 remain readable | Resolved games, shared histories, prose and interaction data |

The AST is the authored document, not the private Langium object graph or a playback plan. Markdown content uses standard mdast nodes without source positions. Concrete source associations live alongside the AST. Runtime Valibot schemas infer TypeScript types; generated JSON Schemas serve configuration editors.

Markdown projects reuse the existing linker, chess validator, content-addressed game store, source lockfile and incremental compiler. A private brace-language projection supplies Langium's symbol/link graph; rich authored data stays attached to its corresponding nodes. Generated coordinates are mapped back to the original Markdown construct for diagnostics. Diagnostic spans currently cover constructs rather than individual tokens. Generic Langium navigation features are not promised for Markdown; Markdown completions have their own source-coordinate adapter.

## Example

```text
---
id: queen-offers
title: A queen offered, a mating net
authors:
  - Philip Krogh
games:
  opera: ./opera.pgn
imports: []
exports: []
---

# Mating nets

@id mating-nets

## The Opera Game

@id opera-finish
@board opera after 30

Notice the coordination between the **rook and bishop**.

@arrow b3 -> b8 green
@prompt Find the forcing move.
@answer Qb8+
```

The executable two-game example is `compiler/examples/queen-offers.chess.md`. `pnpm compile:stories` builds the reader's generated plan from it.

Frontmatter accepts `id`, `title`, `authors`, `games`, `imports`, and `exports`. Unknown fields and duplicate YAML keys fail. YAML uses the core schema; aliases are disabled. `games` maps local bindings to source references; `exports` explicitly names reusable game bindings. Module imports can cross between `.chess-story` and `.chess.md`. Paths remain relative to the importing document. Remote references, selectors and digest references use the existing resolver unchanged.

A level-one heading starts a story; a level-two heading starts a scene. Their display titles are plain text. `@id` immediately following a heading assigns a stable identity. Without it, an ASCII slug is derived from the title. Changing that title can change the derived identity. Identifiers permit ASCII letters, digits, underscores and hyphens, beginning with a letter or underscore; language keywords are reserved. Duplicate identities are diagnostics.

Each scene has exactly one `@board GAME after PLY`; zero denotes the initial position. `@arrow` supports green, red, blue and yellow. `@prompt` and its following `@answer` form one annotation; no other content can intervene. Playback still requires at most one prompt per board and a canonical SAN answer matching the next recorded mainline move. `@text "JSON string"` preserves legacy plain-text annotation values when needed.

Directives begin in column zero in top-level paragraphs. Lists, blockquotes, fenced/indented code and inline code retain their Markdown meaning. Email addresses are ordinary prose. Escape a directive-looking literal line as `\@board ...`. Unknown directives fail. CommonMark paragraphs, emphasis, links, images, lists, blockquotes, code, headings of level 3–6 and thematic breaks are retained as rich nodes. Reference-style link definitions, GFM extensions and arbitrary MDX are outside this initial subset and must not be assumed supported. Raw HTML/comment nodes are retained in authoring data; playback rendering skips raw HTML and uses react-markdown's default URL filtering.

Narrative prose belongs inside a scene in this slice. Document/story introductions independent of boards remain future work. This restriction is diagnosed rather than silently discarded.

## Roundtrip laws

For representable, validated authoring ASTs:

```text
decode(printStructured(ast)) ≡ ast
```

The Markdown printer reparses its output and compares all semantic fields before succeeding. Unsupported structures return `codec/unrepresentable-markdown`; it never silently drops content. Object-key ordering is insignificant, but arrays, identities, titles and note ordering are significant. Adjacent independently stored Markdown notes, empty Markdown notes, duplicate game bindings or arbitrary programmatically assembled mdast trees may not have a representation in this subset. Canonical printing changes formatting and does not preserve concrete syntax.

For valid source:

```text
restore(envelope(decode(source), source)) === source
```

Restoration verifies both the source digest and agreement with the AST. JSON serialization of the envelope preserves this property. BOM, CRLF, Unicode, YAML comments and Markdown spelling remain intact. Edited AST data with stale source is rejected.

`editMarkdownMetadata(source, path, string)` replaces an existing YAML scalar. `editMarkdownBoard(source, storyId, sceneId, game, ply)` replaces one directive. Both validate the resulting document and preserve every source byte outside the replacement range. These are bounded edit operations, not a general lossless AST editor. Adding/removing/reordering arbitrary nodes still requires an explicit canonical print.

## Configuration

Keep either `chess.sources.json` or `chess.sources.jsonc` at the project root. Having both is an error. `.json` remains strict JSON. `.jsonc` accepts line/block comments and trailing commas. Both reject duplicate keys, parse errors, unknown fields and invalid provider shapes. Optional `$schema` is editor metadata and is removed before configuration hashing; comment/schema-location edits do not change source pins.

```jsonc
{
  "$schema": "./compiler/schemas/chess.sources.schema.json",
  "version": 1,
  // Search this local archive before HTTP providers.
  "providers": [{ "id": "archive", "kind": "directory", "path": "./archive" }],
}
```

The repository's `.vscode/settings.json` associates source configs with the generated schema. Other projects can use `$schema` or their editor's schema association. This provides property/value completion, hover descriptions and structural diagnostics. Runtime validation remains mandatory; schema completion does not validate URL-template semantics or game availability.

`editSourceConfig` uses syntax-aware JSONC edits and validates the result, preserving surrounding comments. Lockfiles, cache catalog entries and edition manifests remain generated strict JSON.

`pnpm --dir compiler schemas` generates source-config and frontmatter JSON Schemas from Valibot. `pnpm --dir compiler check:schemas` checks that committed schemas are current. The standalone frontmatter schema is available to editor integrations; Markdown completion supplies field names, game bindings and legal SAN answers. It does not install or configure a separate YAML language server.

## Verification

Seeded properties exercise semantic and exact-source roundtrips across rich content, comments, escapes, Unicode, BOM and CRLF. Targeted-edit tests assert exact equality of unrelated source. Integration checks cover mixed-format linking, incremental replay, missing/invalid dependencies, mapped chess diagnostics, rich playback, editor completion and config hashing. Existing brace-language and playback compatibility tests remain part of the regression suite.

Generic Markdown formatters can join directive lines and change their meaning. The repository formatter excludes `**/*.chess.md`; use the compiler codec for semantic formatting.

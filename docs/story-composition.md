# Composable stories and collections

A source module is a file containing definitions. A story is an authored sequence of board scenes and references to other stories or collections. A collection is an ordered group of named references. These are separate concepts: a file can contain one story, several stories, collections, or only imported references.

| Operation | Representation |
| --- | --- |
| Author one story | A `.chess.md` file with one story heading |
| Publish reusable definitions | `exports` in frontmatter |
| Bind a story or collection from another module | `uses: { local: ./module.chess.md#export }` |
| Group definitions without copying them | `collections` in frontmatter |
| Select a named member of a collection | `collection/member`, including nested paths |
| Compose a story from other definitions | `@include reference as occurrence` |
| Repeat a story independently | Reuse its reference with different occurrence aliases |

## Author one story

`opera.chess.md`:

```text
---
id: opera-module
games:
  score: ../opera.pgn
exports: [opera]
---

# The Opera Game
@id opera

## The queen offer
@id finish
@board score after 30

The **rook and bishop** coordinate.

@prompt Find the forcing move.
@answer Qb8+
```

The module ID, story ID and scene ID have different scopes. A source file is not implicitly a collection. Game paths and names belong to the defining module, even when its story is reused elsewhere.

## Group and regroup

`collection.chess.md`:

```text
---
id: queen-offers
uses:
  opera: ./opera.chess.md#opera
  reti: ./reti.chess.md#reti
collections:
  nets: [opera, reti]
  encore:
    - nets
    - as: opera-again
      use: opera
exports: [nets, encore]
---
```

Members may reference stories, nested collections, imported aliases, or selections such as `nets/opera`. Array order is editorial order. Short string members derive their occurrence name from the final selector segment. Use `{ as: NAME, use: REFERENCE }` when repeating a member or giving its occurrence a different identity. Duplicate occurrence names are errors.

Export visibility applies at the module boundary. Exporting a collection makes its named members selectable through that collection, without separately exporting every private member. Imported bindings can themselves be exported, allowing a module to serve as a catalog.

## Select, compose and decompose

`remix.chess.md`:

```text
---
id: remix-module
uses:
  nets: ./collection.chess.md#nets
  selected: ./collection.chess.md#nets/reti
collections:
  reversed:
    - selected
    - nets/opera
exports: [remix, reversed]
---

# A composed story
@id remix

@include nets/opera as opening

@include selected as comparison

@include nets/opera as reprise
```

`#nets/reti` selects one story out of a collection. Selecting several named paths binds several members independently, providing destructuring without copying their definitions. Regroup them in any order, include them in stories, or export them from a new module.

`@include` can include a whole collection too. It expands in editorial order, including nested collections. An include occurs between board scenes; if placed after a scene's notes it finishes that scene. It does not rewrite that scene or inject annotations into the included story. Continue local content with a new `##` scene heading. The initial scene-scoped prose restriction still applies.

Instance paths distinguish repetitions: this example produces `opening/finish`, `comparison/finish`, and `reprise/finish`. These are distinct reader occurrences backed by the original story definitions. The two Opera uses retain the same game identity/history. A consumer's local `score` binding cannot override an included story's `score` binding.

Splitting or regrouping the authored graph changes references, rather than flattening authored definitions. Canonical printing and exact-source envelopes retain these references. Only a playback projection expands them into concrete reader sequences. Automated source-file extraction/reorganization is not part of this API.

## Public compiler API

```ts
const single = createPlaybackPlan(snapshot, operaModuleUri, "opera");
const selected = createPlaybackPlan(snapshot, collectionModuleUri, "nets/reti");
const composed = createPlaybackPlan(snapshot, remixModuleUri, "remix");
const grouped = createPlaybackCollection(
  snapshot,
  collectionModuleUri,
  "encore"
);
```

A playback collection contains an ordered list of `{ id, plan }` story occurrences, with nested occurrence paths retained. Each plan is independently playable by the existing reader. Consumers can present collection navigation without interpreting authoring syntax. The current app remains a single-story reader; collection navigation UI is separate work.

`@chess-anthology/compiler/collection` exports the browser-safe `PlaybackCollection` type and `parsePlaybackCollection`. The validator checks unique occurrence IDs and every embedded plan's history references. Collections may be empty; story playback still requires at least one supported board scene.

## Linking and builds

Named composition imports participate in source acquisition, dependency invalidation and publication input manifests. Story/member changes invalidate dependent compositions; prose edits reuse unchanged PGN replay. Composition dependencies can form a cyclic file graph when the actual selected definitions are acyclic. The existing brace-language module-import cycle policy is unchanged.

Linking diagnoses missing/private exports, missing members, selecting a member from a story, duplicate names and recursive story/collection expansion. Definitions preserve their original game scopes. Playback keeps the existing legal-answer and recorded-mainline capability checks.

Acquisition and publication validation currently operate on whole imported modules. Selecting one story does not yet prune unrelated game dependencies or diagnostics from the same module. Shared histories are deduplicated within each story plan; collection serialization can repeat histories between its independent plans.

## Versioning and codec laws

Composition uses authored JSON AST version 2: `uses`, `exports`, `collections`, and include nodes inside story sequences. Plain Markdown stories keep authored version 1; brace stories keep version 0. Playback story versions 2/3 are unchanged. A separate playback-collection version 1 wraps independent plans.

The same codec laws apply: structured AST → canonical Markdown → AST preserves representable data; untouched source envelopes restore exactly; source references remain unresolved in authoring data. Schema generation covers `uses` and collection frontmatter alongside existing metadata.

Executable examples are in `compiler/examples/composition/`. Tests cover standalone/grouped/selected stories, nested and repeated inclusion, name-scope isolation, invalid references/cycles, incremental invalidation, acquisition, and semantic/exact-source roundtrips.

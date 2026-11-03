# Authoring and codec contract

Status: design contract for the next authoring experiment. The current runtime implements [single-artifact lesson JSON version 1](lesson-format.md), not the flat language or multi-game document described here. Syntax examples from discussions are exploratory, not a supported file format.

## One document, two authoring representations

Authors can work in a human-oriented flat source or in a structured document. Both represent the same authored information and must support the same features. A visual editor edits that same document; it must not create a privileged feature set unavailable to text authors.

Move history, prose, supplementary annotations, presentation and interaction rules are composable facets. A document containing only a game score, an illustrated commentary, a playable lesson, and a story containing several games do not require separate incompatible document models. Genre labels may aid discovery without determining storage capabilities.

Separate responsibilities while allowing authors to write them together:

| Responsibility | Examples |
| --- | --- |
| Structure and meaning | Ordered prose, games, positions, variations, source attribution, board occurrences, explanatory arrows and marked squares |
| Presentation | Layout, emphasis, board orientation, arrow brush, labels, transitions |
| Behavior | Learner turn, accepted moves, authored alternative feedback, hints, retry and reveal rules |

An arrow's endpoints and explanatory label convey meaning. Its brush and line treatment convey presentation. Neither requires a user action. Defaults must not erase the distinction between an explicitly authored value and an inherited value when that distinction affects later editing.

Co-location does not imply arbitrary executable JavaScript. Begin with declarative behavior whose meaning can be validated and rendered consistently. Reader session state, such as a temporary try, is separate from the authored document.

## Shared records and narrative occurrences

A story may introduce the Opera Game, switch to Réti–Tartakower to demonstrate a related pattern, then return to an earlier Opera Game position. Store each game record once and reference it from independently identified board occurrences. Two occurrences of the same game can have different orientation, annotations and interaction rules without mutating each other or the source score.

Move references must distinguish variations. A ply number alone is insufficient outside a selected line; SAN such as `Qb8+` alone is also insufficient. Human selectors can be convenient syntax, but resolution must identify a specific game and move-tree node, including the initial position. Reject missing or ambiguous targets. An author can draft an unresolved reference and receive a diagnostic without losing the draft.

A story is an ordered composition of these occurrences and other content, not necessarily a container with exactly one game. Prose and annotations normally follow the position they describe; explicit ordering is preserved when several items share an anchor.

## Imports, exports and linking

The flat language and structured document both express module imports, named exports and references between records. Parsing a module does not require all referenced games to be locally available. A structured module is relocatable: it carries declarations and unresolved references, analogous to an object file. A linker combines available modules and chess records into a resolved document graph for a particular reader or export target. The parsed authored module remains unchanged.

Distinguish three operations:

| Operation | Meaning |
| --- | --- |
| Module import/export | Name and reuse authored declarations across narrative modules |
| Source ingestion | Adapt external PGN, FEN, EPD or database records into typed chess records |
| Serialization/export projection | Encode the native document or produce a target such as PGN |

A narrative module may export a story or reusable annotations as well as game references. An imported chess record may contain only a position; it must not acquire an invented move history. PGN can carry game scores and variations; FEN supplies a position; EPD supplies a position plus operations. Preserve EPD operations, including unknown ones, rather than treating EPD as merely a FEN string. These distinctions follow the [PGN specification and implementation guide, sections 16.1–16.2](https://www.saremba.de/chessgml/standards/pgn/pgn-complete.htm). Adapter support is proposed; the runtime currently supports PGN/FEN, not EPD or database resolution.

Every import declaration needs a local binding, source identity and record selector. References use scoped identities, not display titles or heuristic matching. The document graph can express a board occurrence referring to a game, an annotation referring to a move, or a comparison referring to several positions. Dependency edges identify what must be available to resolve those relationships; they are distinct from editorial relations such as two players having met.

Illustrative declarations, not final syntax:

```text
import { matingNet } from "./patterns.chess-story"
import { opera } from pgn("./opera.pgn", record="opera")
import { comparison } from database("historical", record="provider-record-id")
export { queenSacrificeStory }
```

Source configuration binds the logical database name to an adapter and connection settings outside the authored document. Credentials never belong in authored imports or lock data. Database results require explicit record IDs and provenance; queries returning several matches cannot silently choose one. Importing an external record is a data operation, not permission to execute code supplied by it.

Maintain two related representations:

- The authored module graph retains import declarations, export identities, relations, selectors and unresolved references. Its flat/structured codec works even offline or with missing dependencies.
- A linked bundle binds those references to resolved chess records and move nodes, carrying provenance and resolution metadata. It can embed the dependency closure for offline use without pretending those copies were inline authored content.

A resolution manifest records the source, record ID, revision when available, raw content digest and adapter version. Pin or snapshot external records for reproducible publication; a live database reference is an explicit choice to permit changing results. Cache resolved records by verified content identity, not just their URL. A source refresh produces a reviewable change and revalidates affected move references. Two games sharing a position are not thereby the same game.

Linking reports missing sources, unavailable records, ambiguous exports, conflicting identities and changed pinned content. Separate unavailable dependencies from invalid chess. A draft can preserve unresolved imports; publication defaults to requiring the dependency closure for its reachable content. A preview may show an explicit unavailable-content placeholder. Neither path silently deletes a reference or substitutes a similar game.

Define cycle behavior before shipping modules. For the first slice, reject cycles in module imports with the dependency path in the diagnostic; ordinary references in the content graph may be cyclic. Keep linking independent from rendering so configured adapters can serve a text tool, visual editor, server or offline build alike.

## Losslessness and codec laws

Define the supported structured value domain before claiming an isomorphism. For every valid supported document `d`:

```text
decode(encode(d)) ≡ d
```

Here equivalence includes all authored data, identities, ordering, comments, annotations, presentation and behavior. Object-key order is insignificant unless represented as authored syntax. Runtime caches, resolved chess positions and reader progress are not authored data. Defaults and normalization must be specified rather than silently changing authored intent.

For supported source `s`, semantic round-trip alone means:

```text
parse(print(parse(s))) ≡ parse(s)
```

That law does not preserve the exact source spelling. If the structured representation is to be isomorphic to the original flat source, it must also retain concrete syntax: author comments, whitespace, line endings, quoting and alternative spellings. Use a document envelope containing the semantic tree plus lossless syntax information, rather than claiming an abstract tree alone can reproduce those bytes. JSON serialization of that envelope must retain the syntax information too.

The source-preserving codec must satisfy:

```text
print(parseLossless(s)) === s
```

An untouched document is byte-identical. Editing one node should preserve untouched syntax; newly created nodes use documented printing rules. A formatter is a separate explicit normalization operation, not an implicit step in saving. Source maps and syntax associations must be updated after edits; stale syntax must never override changed semantic values.

Malformed drafts remain editable and saveable as source with diagnostics. They are not valid executable documents. Structured invalid drafts likewise require a draft envelope rather than being mislabeled as validated documents.

Native decoding must reject unsupported versions and unknown meaningful fields, or retain explicitly supported opaque extension nodes verbatim. Never silently strip data. Preserving an extension does not mean understanding it: execution and rendering must report unsupported capabilities. Extension namespaces and the ability to relocate opaque syntax remain open design questions; version 1 currently rejects unknown fields.

## Diagnostics pipeline

| Stage | Responsibility | Example |
| --- | --- | --- |
| Lexical | Recognize source tokens | Unterminated quoted value |
| Syntax | Build the source tree | Unclosed directive |
| Structural | Validate node shapes and versions | Prompt missing its answer field |
| Reference resolution | Resolve identities and move selectors | Unknown game; ambiguous variation target |
| Chess semantics | Validate positions, paths and answers | Move illegal in the referenced position |
| Capability analysis | Check the chosen target supports the document | Reader cannot execute a declared interaction |

Flat input passes through all stages. Structured input skips lexing and parsing, then uses the same structural validator and semantic analyzer. Chess analysis operates on well-formed relevant nodes; recovery should still report independent errors elsewhere. No renderer-specific interpretation of chess references.

Diagnostics carry a stable code, stage, severity, message and structured document path or node identity. Source input adds source spans through a source map. Related spans can point to a declaration and its invalid use. Both text and visual editors therefore report the same underlying semantic problem at the appropriate location.

Separate authored trees from resolved execution data. Resolving a convenient human selector must not overwrite the author's chosen spelling. Linting may propose fixes; saving must not silently apply them.

## Codecs versus projections

Native flat/structured conversion is a codec. PGN-only export, a FEN snapshot and static prose export are projections with different expressive power. They must not share an unconditional lossless promise.

A projection returns output plus machine-readable losses, each with a code, affected path or node identity, and reason. For example, a PGN projection may preserve moves and representable comments/arrows while reporting dropped narrative layout, interactions and unsupported annotations. Exporting several games must preserve their identities or report any lost cross-game relationship. A lossy import is subject to the same reporting requirement, including normalization or ignored source tokens.

Default programmatic projection policy rejects losses unless the caller explicitly permits them. The authoring UI presents the concrete loss report before a lossy export; the original native document stays available. Capability warnings about rendering are separate from data-loss reports about serialization.

The current export controls are not yet this API: PGN exports source notation and omits lesson events; FEN exports the displayed position. The existing PGN parser is permissive and its normalized parsed tree is not a lossless representation of arbitrary source PGN. Keep original notation alongside parsed data; do not claim full import fidelity until ignored syntax can be detected and reported.

## Next experiment and acceptance criteria

Before freezing syntax, implement one small codec slice around a two-game story and a composition. Include prose, move-tree references, one arrow, a presentation override and an interaction with supportive alternative feedback. Exercise text and structured authoring against the same semantic analyzer.

Required checks:

- Structured to flat to structured preserves every supported authored value, including explicit defaults and ordered items.
- Unchanged flat to structured envelope to flat preserves exact source bytes, including author comments, whitespace and line endings.
- A targeted visual edit preserves unrelated source syntax and both references to a reused game.
- Missing game, missing move, ambiguous branch and illegal answer produce matching semantic diagnostic codes for either input representation, with source spans where available.
- A narrative imports a reusable module and PGN/FEN/EPD records through the same resolver boundary. Missing database records remain intact across codec round-trips and produce linking diagnostics.
- A pinned dependency closure builds offline; a changed external record is detected rather than silently changing a published story.
- Unknown data and versions fail explicitly; retained extensions survive round-trip without being executed as known behavior.
- PGN/FEN projections report every unsupported authored feature and require an explicit loss policy.

The experiment establishes the codec boundary first. It does not require a rich editor, arbitrary scripting or a final public syntax.

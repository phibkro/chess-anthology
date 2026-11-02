# Internal modules and compiler phases

These are internal modules with explicit interfaces, not a collection of new packages or network services. The existing isolated compiler experiment remains on `prototype/langium-chess-compiler` until it is integrated into the reader. Names indicate ownership; implementation files are not public interfaces.

| Module                   | Interface / current location         | Owns                                                          | Must not own                                            |
| ------------------------ | ------------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------- |
| Anthology/discovery      | `src/App.tsx`, `src/collection.json` | Browsing, contextual entries, editorial navigation            | Chess rules or session transitions                      |
| Reader                   | `src/lesson/index.ts`                | Opening compiled lessons and rendering the current experience | External source acquisition or compiler workspace state |
| Reader document/notation | Internal `schema.ts`, `chess.ts`     | Current version-1 lesson validation and recorded notation     | UI layout or reader tries                               |
| Player                   | Internal `store.ts`                  | Session commands, cursor, hints, tries and reveal             | Rewriting recorded games or authored content            |
| Board presentation       | Internal `Board.tsx`                 | Chessground adaptation and pointer interaction                | Deciding whether an authored answer is supported        |
| Compiler document        | Prototype `src/document/index.ts`    | Plain authored values, structural schema, result/error types  | Langium, React, filesystem or chess-engine objects      |
| Compiler                 | Prototype `src/compiler/index.ts`    | Compiler operations and immutable build snapshots             | Reader session state or credentials                     |
| Source/CLI adapters      | Prototype `src/adapters/`            | Explicit file reads and command output                        | Independent semantic rules                              |
| Language-server adapter  | Prototype `src/compiler/lsp.ts`      | Mapping editor document lifecycle to compiler checks          | A competing authored model                              |

The smaller reader modules still live inside `src/lesson`. Extract separate entrypoints/packages only when actual consumers need them. The reader's version-1 model and compiler's version-0 model are not yet unified.

## Compiler phase interfaces

Every numbered directory exposes `index.ts`. Other phases import through it. A static-import architecture check enforces this for the prototype; generated parser files are private to parsing. The guard covers current static imports/re-exports and rejects dynamic imports pending a stronger scanner.

| Phase                   | Input → output                                                                  | Invariants and failure values                                                                              | Verification                                                                        |
| ----------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `100-parsing`           | Flat text → Langium syntax representation                                       | Explicit JSON string semantics; lexical/syntax failure is a value; source remains available                | Malformed-source fuzzing; escaped-Unicode round trips                               |
| `200-semantic-analysis` | Parsed/structured authored values → validated shape and local issues            | Local shape, names and occurrence identities do not require available games                                | Schema fuzzing; duplicate-name/occurrence checks; codec properties                  |
| `300-linking`           | Modules, declarations, configured sources → resolved references and diagnostics | Explicit imports/exports; missing dependencies remain identifiable; private workspace state stays internal | Missing/private/ambiguous references; cycles; dependency removal/restoration        |
| `400-chess-analysis`    | Linked game source and scene → game history, legal moves and chess issues       | Standard/Chess960 rules; all parsed branches checked; answers checked for legality, not optimality         | PGN fuzzing; historical fixtures; content-cache reuse                               |
| `500-emission`          | Authored/linked values → plain output, canonical text or source envelope        | No Langium objects in emitted values; projections cannot silently claim losslessness                       | Structured↔flat property; exact untouched-source property; stale-envelope rejection |
| `600-build`             | Source revisions → immutable snapshot and work report                           | Dependency invalidation, content-addressed reuse, previous snapshots stable                                | Incremental-vs-clean property; pure-view and immutability checks                    |

The numbering identifies responsibilities and prerequisites, not an arbitrary configurable list of passes. Local semantic analysis is separate from chess analysis that requires linking. Langium's adapter registers linking/validation callbacks; its document builder controls their lifecycle. We have not reimplemented that lifecycle as six independent processes.

## History, snapshots and reads

A game history contains immutable position frames derived by replaying its recorded moves. A build snapshot contains a revision, parent revision, emitted documents and game histories. Parent revision is an identity, not a durable event log or a retained chain of all past builds. Callers may retain snapshots explicitly.

`selectPosition(snapshot, gameUri, ply)` is a pure selection returning `Result<Frame, Failure>`. Reading a position does not append an event, advance a build revision or trigger replay. A UI may keep a cursor as ephemeral session state; analytics are not implied by viewing a position.

Changes to source text are write commands. Persisting a document, refreshing a database record or publishing is an external effect handled by an adapter. We do not event-source ordinary reads, and this prototype does not introduce an event store.

## Incremental build behavior

The compiler owns a persistent in-memory Langium workspace. It diffs source revisions, updates changed narrative files and propagates invalidation through reverse dependency edges for module imports and PGN paths. Unchanged syntax and unaffected emitted documents are retained. Linked dependencies can revalidate without reparsing unchanged source.

Chess replay is cached by SHA-256 of source content plus a rules/library configuration key. Validator callbacks, emission and completion share the workspace's chess-analysis instance. Stored mutable chessops positions remain private to compiler analysis; public history frames and build output are deeply frozen, plain data.

A prose edit does not replay a game. A PGN edit invalidates its importers and stories without reparsing their unchanged text; only changed game content is replayed. Invalidation is currently at document granularity, not per paragraph or AST node. Cache entries are in-memory and unbounded for this experiment; discarding the compiler releases the cache. No durable build database, distributed scheduler or filesystem watcher is implied.

## Errors are values

The public compiler/codec/selection interfaces return discriminated `Result<T, Failure>` values. Failures distinguish syntax, schema, chess, integrity, selection, IO and infrastructure problems. Consumers explicitly inspect `ok`; they do not need exception-based control flow for invalid content or unavailable positions.

A successfully computed build snapshot can contain document diagnostics: `ok` means compilation completed, not that the document is publishable. Error diagnostics must be checked by a publication target. Infrastructure failures leave the previous snapshot usable; that compiler instance then requires recreation rather than reusing partially updated workspace state. Concurrent updates return `build/busy` and must be sequenced by the caller.

Third-party parser/runtime exceptions and file-read failures are caught at their adapter seam and returned as values. We have not rewritten Langium or chessops internally. LSP follows the protocol's own diagnostic and error conventions.

## Established properties and remaining limits

Property checks generate authored values, text, JSON and edit sequences, with reproducible seeds and shrinking. They cover semantic codec round-tripping, untouched source preservation, malformed inputs as values, old snapshot stability, no-op work, and incremental/clean-build equivalence.

This still does not establish a complete isomorphic editing codec. Source-preserving semantic edits, exhaustive foreign-PGN loss reporting, EPD/database adapters and browser packaging remain open. Position histories currently expose mainline snapshots; parsed side variations are validated but not exposed as selectable history branches.

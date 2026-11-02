# Chess Anthology

**A playable library of chess history and human creativity.**

Chess Anthology is a craft-first, open project for discovering and appreciating chess through historical games, human-composed problems, their creators, and the worlds around them. Learning follows curiosity rather than ratings, streaks, or engagement optimization.

## Two distinct products

| Product                          | Promise                                                                                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Chess Through History**        | Explore real games through people, rivalries, matches, tournaments, eras, and their historical context. Replay the games; make meaningful decisions along the way.       |
| **The Art of Chess Composition** | Encounter deliberate works of chess art by named human composers. Solve their stipulations, discover the idea behind each construction, and understand their provenance. |

Both products can eventually share a playable reader, portable narratives, and an optional research/import assistant. **Shared infrastructure is an implementation possibility, not a reason to collapse the editorial distinction between the products.**

## Principles

- **Curiosity over competition:** No obligatory lessons, ratings, streaks, or content funnels.
- **Craft over volume:** Publish fewer exceptional experiences before scaling a catalog.
- **People and provenance:** Credit chess players, composers, historical sources, and modern editors. Show uncertainty rather than inventing certainty.
- **Player agency:** Explore, rewind, branch, pause, mute, or skip prompts.
- **Open by design:** Favor interoperable PGN/FEN and human-readable content; keep formats portable and contributors empowered.
- **Agents as librarians, not authorities:** Research/import assistance is optional, inspectable, and subject to factual and chess verification.
- **Build the tool before the business:** Do not introduce monetization or platform-growth obligations ahead of usefulness and quality.

## Start here

1. [Project orientation and handoff map](docs/START-HERE.md)
2. [Charter, mission, value, and boundaries](docs/CHARTER.md)
3. [4EM enterprise model](docs/4EM.md)
4. [Two product concepts](docs/PRODUCTS.md)
5. [Experience and editorial principles](docs/EXPERIENCE.md)
6. [Content, provenance, and open format](docs/CONTENT.md)
7. [Iterative delivery and verification](docs/DELIVERY.md)
8. [Technical lead handoff](docs/HANDOFF.md)
9. [Community and stewardship](docs/COMMUNITY.md)
10. [Sources and prior art](docs/REFERENCES.md)

A proposed first experiment is specified in [the vertical-slice brief](docs/experiments/001-morphy-slice.md). [Decisions and assumptions](docs/DECISIONS.md) explain what is settled versus provisional.

**Project status:** a working shared-reader prototype is implemented. The earlier discovery documents remain proposals where they have not been explicitly implemented or superseded below.

**Licensing note:** New prototype code is GPL-3.0-or-later. Pre-existing documents and separately sourced content are not automatically relicensed; see [third-party notices](THIRD-PARTY-NOTICES.md) and [COMMUNITY](docs/COMMUNITY.md).

## Working prototype

The original editorial design is the current default. The earlier `/original/` and `/revised/` comparison snapshots remain available.

```sh
pnpm install
pnpm --dir prototypes/chess-compiler install
pnpm setup:secrets
pnpm dev
```

The app uses Vite+ (Vite, Vitest, Oxfmt and Oxlint), React, Tailwind CSS, XState Store, Valibot, Chessground and chessops. The reader currently includes two compositions and two historical games, with legal move entry, optional checkpoints, graded hints, reveal, skip, rewind and notation export.

- `src/content/lessons.json`: artifact scores and separately authored narratives.
- `src/lesson/schema.ts`: Valibot content contract.
- `src/lesson/chess.ts`: parsing, legality checks, compilation and interchange.
- `src/lesson/store.ts`: event-driven lesson session.
- `GLOSSARY.md`: developer/editor domain language; not reader-facing ontology.
- `content/catalog/fide-albums.json`: 26 bibliographic records, refreshed with `pnpm index:albums`.
- [Research and reuse notes](docs/research/lesson-foundations.md).
- [Shared-reader experiment](docs/experiments/002-shared-lesson-reader.md).

`pnpm check:all` runs formatting, lint/type checks, tests, duplication checks, Knip and production build. `pnpm check:secrets` scans the working tree; pre-commit scans staged changes. Commit messages follow Conventional Commits.

**Current limits:** standard chess; mainline playback; authored answers rather than engine grading; no automated evaluation or complete Réti solution proof. PGN side variations and comments are validated and preserved on export, but branching playback is not yet exposed. Local imports do not upload content. Importing a position does not invent a solution.

**Software license:** new prototype code is GPL-3.0-or-later, compatible with Chessground and chessops. This does not relicense pre-existing project documents, historical sources, modern annotations or future album contents. See [third-party notices](THIRD-PARTY-NOTICES.md).

### Lesson annotations and feedback

[Version 1 of the lesson document](docs/lesson-format.md) combines PGN with ordered text and prompt events, appended after a ply index or legal move path. Unversioned checkpoint lessons still import. [Lichess source research](docs/research/lichess-lesson-formats.md) explains why we adapt Study/gamebook concepts instead of importing its application controller.

A legal off-line try now stays on the board. Continuation pauses until the reader retries, reveals the idea or navigates away. The default feedback is “Try again.” More specific encouragement is authored for individual moves; the reader does not guess whether an idea is close to the solution.

The [authoring and codec contract](docs/authoring-codec-contract.md) records the proposed lossless flat/structured format and shared diagnostics pipeline; the flat codec is not implemented yet.

[Chess compiler decisions](docs/adr/0001-chess-compiler.md) and the [Langium experiment](docs/experiments/003-langium-compiler.md) describe the next authoring slice. Its disposable implementation is on branch `prototype/langium-chess-compiler`.

[Internal module and compiler phase interfaces](MODULES.md) describe the current seams, snapshot/read model, incremental builds and error-value contracts.

On the compiler branch, the web reader consumes the compiler package at build time. `pnpm compile:stories` generates a portable two-game playback plan; `pnpm dev` and `pnpm build` regenerate it. Open **A queen offered, a mating net** in the playable collection. The browser consumes the plan and browser-safe schema; Langium stays in the build tooling.

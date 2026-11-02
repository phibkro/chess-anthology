# Lesson foundations and source discovery

Verified against upstream documentation and installed package interfaces on 2 November 2026.

## Reuse decisions

| Resource                                                               | Role                                                       | Current choice                                                                              |
| ---------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [Vite+](https://viteplus.dev/guide/)                                   | Vite build/dev, Vitest, Oxfmt, Oxlint and type checks      | Adopted; local `vp` CLI and tracked Vite+ hooks                                             |
| [XState Store](https://stately.ai/docs/xstate-store)                   | Small typed event-driven session model                     | Adopted v4; React subscribes through `useSyncExternalStore`; no full statechart runtime yet |
| [Chessground](https://github.com/lichess-org/chessground)              | Click/drag board and board drawing                         | Adopted; does not enforce chess rules by itself                                             |
| [chessops](https://github.com/niklasf/chessops)                        | Legal moves, SAN/UCI, PGN/FEN, board compatibility         | Adopted; parsed branches are separately checked for legality                                |
| [Lichess opening names](https://github.com/lichess-org/chess-openings) | ECO/name metadata in TSV, PGN sequences, generated UCI/EPD | CC0; one prefix-matched Philidor record included, no full database needed yet               |
| [Lichess PGN viewer](https://github.com/lichess-org/pgn-viewer)        | Ready-made embeddable playback                             | Useful prior art; not added because the lesson needs its own prompt/session state           |
| [Valibot](https://valibot.dev/guides/schemas/)                         | Runtime content boundary and inferred TypeScript contract  | Adopted for lessons and album catalogue imports                                             |
| [jscpd](https://github.com/kucherenko/jscpd)                           | Duplication checks                                         | Adopted; interpreted the request's `jspcd` as this tool                                     |
| [Knip](https://knip.dev/)                                              | Unused files, exports and dependencies                     | Adopted for active source                                                                   |
| [Gitleaks](https://github.com/gitleaks/gitleaks)                       | Staged and working-tree secret checks                      | Required pre-commit; pinned binary setup verifies official-release SHA-256 checksums        |

Chessground and chessops use GPLv3-or-later. New prototype code uses that license; documents and content rights remain separate. Dependencies are pinned in the manifest and lockfile.

## WFCC / FIDE Album discovery

The organization is **WFCC**, the World Federation for Chess Composition. Its [FIDE Albums page](https://www.wfcc.ch/fide-albums/) lists 26 published volumes through 2019–2021 and links a combined register covering 1914–2021. The 2022–2024 selection/results are distinct from a published volume, so the catalogue script does not manufacture a 27th publication.

`pnpm index:albums` refreshes publication periods, publication years and diagram counts. It deliberately indexes the bibliographic table, not the complete compositions. Future records should retain volume, section, problem/page identifiers, composer(s), original publication, stipulated task, position, intended solution, judges' points and corrections.

Eight sections span directmates, studies, helpmates, selfmates, fairy compositions and retro/proofgames. Standard chess legality alone cannot certify all of these. Start with one verified orthodox study, retain corrections, and select specialized validation per genre. Public indexes, sample PDFs and purchasable volumes are different source artifacts; preserve rights status for each rather than assuming full scans or a database can be redistributed.

## Notation boundaries

| Format               | Meaning                                                         | Prototype support                                                                       |
| -------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| PGN                  | Game headers, movetext, comments, NAGs and recursive variations | Local import/export; legal validation of parsed branches; mainline playback             |
| FEN                  | One position, side to move, castling, en passant, clocks        | Position import and current-position export                                             |
| SAN                  | Human move labels, including captures, checks and castling      | Keyboard input and score display                                                        |
| UCI move strings     | Coordinate moves, including promotion suffix                    | Stable paths and accepted-answer comparison                                             |
| EPD                  | Position description with optional named operations             | Future adapter; do not discard operations by pretending EPD is merely FEN               |
| Lesson JSON          | Artifact plus separately authored narrative/checkpoints         | Valibot-validated import/export; prototype contract, not a universal composition format |
| Fairy/retro notation | Rules and tasks outside standard forward play                   | Out of scope; requires explicit variant/task semantics and specialized tooling          |

The chessops PGN parser is permissive and can skip malformed tokens. Legality checks certify parsed moves, not that every source token was preserved. Review normalized exports before promoting imported content to a sourced lesson. An imported lesson's source fields are claims, not automatic certification.

## Source verification for the first scores

WFCC supplies the Carpenter and Réti positions and selected lines. The Opera score is cross-checked against a Lichess study, without copying its modern annotations. ASK Réti's article links a 1910 newspaper report and a score ending after 10.Bg5+; modern study creation metadata is not the historical event date. The original historical source and independent specialist review remain the next stronger checks.

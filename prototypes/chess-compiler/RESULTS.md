# Observed results — 2026-11-02

Verdict: Langium is a viable candidate for the language frontend. Keep adoption provisional until source-preserving edits, browser packaging and foreign-format loss reporting have been demonstrated. No public syntax has been frozen.

| Experiment                                                                         | Observed result                                                            |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Two-module, two-game narrative                                                     | No diagnostics; two resolved board occurrences                             |
| Opera Game prompt after ply 30                                                     | Legal SAN completion includes `Qb8+`                                       |
| Réti–Tartakower prompt after ply 16                                                | `Qd8+` validates as legal                                                  |
| Unknown module/game, private export, missing anchor, illegal answer, invalid arrow | Explicit diagnostics with source ranges                                    |
| Lexical and parsing failures                                                       | Separate diagnostic stages; chess checks do not run on malformed documents |
| Structured → canonical text → structured                                           | Equal authored data for the example                                        |
| JSON envelope → original source                                                    | Exact LF and CRLF text, including comments and whitespace                  |
| Structured data changed behind retained source                                     | Restore rejects the stale envelope                                         |
| Scene validation called directly on structured data                                | Same `chess/illegal-answer` code as flat source validation                 |
| Export removed from a dependency                                                   | Dependent reference becomes unresolved on rebuild                          |

## Actual LSP exchange

A separate client drove the stdio server using framed JSON-RPC, rather than calling provider methods directly:

1. `initialize` and open the example workspace: valid story publishes no diagnostics.
2. Request completion inside the Opera Game answer: 46 legal-move items, including `Qb8+`.
3. Change answer to `Qh9`: `chess/illegal-answer`, line 7, characters 43–48 (zero-based).
4. Restore the story and request definition on `opera`: resolves to its exported declaration in `library.chess-story`.
5. Open/change the library to remove the `opera` export: the story receives `link/unresolved-game` without editing the story.
6. `shutdown` / `exit`: process exits successfully.

## Reproduction and limits

`pnpm demo` exposes the in-process scenarios; `pnpm compile examples` emits the authored data, diagnostic list and resolved occurrences; `pnpm check` type-checks the prototype. Generated code is committed and can be regenerated with `pnpm generate`.

The LSP smoke client was an external verification harness, not a shipped editor extension. Browser execution, large-database throughput, source-preserving semantic edits, unavailable-record fetching and EPD behavior were not measured. See [README.md](README.md) for remaining scope limits.

## Phase/snapshot follow-up

The implementation now exposes numbered internal modules, immutable build snapshots and Result values. A persistent builder was checked against clean builds over generated edit sequences. Observed work reports:

| Change                  | Narrative parses | Game replays | Emitted documents |
| ----------------------- | ---------------- | ------------ | ----------------- |
| Initial example         | 2                | 2            | 2                 |
| No change               | 0                | 0            | 0                 |
| Story prose only        | 1                | 0            | 1                 |
| One PGN source revision | 0                | 1            | 2                 |

The property suite found a genuine escaped-Unicode round-trip failure in the default string converter. The grammar now specifies JSON strings and shares their converter with the LSP. Generated round-trip checks include escapes, control characters, Unicode and LF/CRLF source. Exact source restoration still preserves untouched source only; it is not an editing codec.

The phase follow-up passes nine seam/property/fuzz suites with seeds `20261102` and `8128`. A later LSP smoke exchange still resolves references, completes legal moves, reports edits and shuts down cleanly. The root reader continues to pass its 29 tests.

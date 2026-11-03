# Ratifying a Chess960 compatibility profile

Status: partially implemented project contract, 2 November 2026. The executable subset below is adopted for this prototype. The remaining decisions are proposals; the compiler does not yet enforce the whole profile or import external FEN declarations in narrative syntax.

## Separate the authorities

FIDE defines the game rules. The PGN specification defines game-record structure and setup tags. Chess960 PGN conventions and X-FEN/Shredder-FEN define extensions needed for interchange. Our own contract must select and version its supported profile and define errors, preservation and conflicts where those sources leave implementation choices.

[FIDE Guidelines II](https://handbook.fide.com/chapter/e012023), [PGN specification, sections 9.7 and 16.1](https://www.saremba.de/chessgml/standards/pgn/pgn-complete.htm), [Chess960.net notation discussion](https://chess960.net/start-positions/).

The linked page itself distinguishes ordinary FEN for a complete initial array from later positions where extra rooks can make castling rights ambiguous. Its example spells the setup tag `Setup`; canonical PGN uses **`SetUp`**. Importing an alias permissively is a separate policy from writing canonical output.

## Proposed decisions

| Question | Contract to ratify |
| --- | --- |
| Complete Chess960 initial array | Both armies and pawn ranks are present, back ranks mirror, bishops occupy opposite colours, king is between the two rooks. Check this only for a declaration claiming a new-game initial array. |
| Midgame/composition position | Validate a position under an explicit ruleset. Do not demand the full initial army; a setup FEN may describe a study or an excerpt. A legal setup is not a proof of reachability from a particular original array. |
| Ruleset identity | Keep `standard` / `chess960` separate from the position. A FEN alone does not reliably identify the variant. A numbered Chess960 start is a convenience reference using an explicitly named numbering scheme, not a replacement for a resolved position. |
| Portable Chess960 PGN | Export `[Variant "Chess960"]`, `[SetUp "1"]` and `[FEN "..."]` with the movetext. Adopt these conventions rather than invent a new chess-move format. |
| Castling rights | Resolve each entitlement to the relevant rook's origin square. Accept documented X-FEN and Shredder-FEN inputs; reject unresolved ambiguity. Prefer explicit rook-file letters for Chess960 interchange where the selected target supports them. Preserve the original spelling in exact-source mode. |
| Narrative imports | Permit a separately imported FEN/position artifact as authoring input in a future syntax extension. Link it to a ruleset and game. Export a self-contained PGN with setup headers when portable game interchange is requested. |
| Conflicting setup sources | If an external setup and embedded PGN setup disagree after the specified normalization, emit `source/conflicting-setup`. Neither silently overrides the other. |
| Unknown metadata | Preserve raw source and unknown tags/operations. Canonical export must report transformed or omitted information; exact source restoration and canonical export are distinct operations. |

FIDE's initial-array requirements concern starting a game, while PGN's `SetUp` mechanism describes games starting from other positions. The separate validators above are therefore deliberate: `validateInitialArray` must not become a universal condition for `validatePosition`.

The project already uses chessops, whose README advertises Chess960 and whose implementation resolves PGN headers, castling geometry and FEN. That is useful prior art, not a substitute for verifying our own import/export contract. [Chessops source and documentation](https://github.com/niklasf/chessops).

## Ratification procedure

1. Record each rule's authority, chosen policy, version, accepted aliases, and unsupported cases in a contract table like this one.
2. Add small input/output fixtures and expected diagnostic codes. A behavior is ratified only when its accepted/rejected cases and observable output are agreed, not because a dependency happens to return some value.
3. Run the same fixtures against the current compiler and each proposed Go adapter. Distinguish semantic agreement from exact text preservation and from independent validation of chess legality.
4. Promote this profile from proposed to accepted, record differences from current behavior, then implement it in a tracer-bullet change. Version externally visible format changes and keep unsupported behavior explicit.

Minimum additions to the shared corpus: all 960 initial arrays; invalid bishop colours, king placement and mirror arrangements; the orthodox array within Chess960; reduced-material setups; both castling sides; king/rook already on destination squares; transposition castling; attack/path obstructions; moved/lost rights; additional/promoted rooks; X-FEN/Shredder equivalence; missing/misspelled headers; conflicting external/embedded setup; exact PGN preservation; and explicit rejection by adapters lacking the required variant capability.

Use hand-reviewed edge cases and an independent implementation where possible. Agreement between two wrappers around the same chess engine is not an independent oracle. The [Go research](go-chess-compiler.md) audits candidate libraries against these requirements.

## Executable subset: conformance corpus v1

`compiler/src/chess960.test.ts` exercises the public `compile`, `selectPosition` and `createPlaybackPlan` seams. Its versioned, engine-independent edge-case data lives in `evaluation/corpus/chess960.json` relative to the compiler prototype, so a future Go adapter can consume the same inputs and literal expected results.

| Obligation | Evidence and current policy |
| --- | --- |
| Complete starting arrays | Independently enumerate distinct permutations of `BBKNNQRR`, then filter for opposite-colour bishops and king between rooks. Assert 960 unique arrays, including `RNBQKBNR`; compile and select every mirrored full-army position. This demonstrates acceptance, not rejection of invalid initial-array declarations. |
| Reduced-material setup | Twelve accepted castling fixtures intentionally omit most pieces. They remain valid setup inputs. |
| Castling geometry | Literal resulting FENs cover both sides, both colours, ordinary movement, stationary king, stationary rook and king/rook exchange. SAN and normalized king-to-rook UCI are checked in history and emitted lesson prompts. |
| Castling legality | Eight rejected fixtures cover attacks on the king, transit and destination, occupied paths, an uncovered attack on a stationary king, absent rights, and king/rook rights lost after moving away and returning. An attacked rook alone does not prevent castling. |
| Rook entitlement | X-FEN `K` and explicit rook-file rights are exercised; an additional rook fixture grants the inner rook entitlement explicitly. This does not establish a general ambiguity-rejection policy. |
| Missing setup | A PGN explicitly marked `Chess960` requires a nonempty FEN header, as do the case-insensitive aliases `Chess 960`, `Fischerandom`, `FischerRandom`, and `Fischer Random`. A canonical `SetUp "1"` also requires FEN regardless of variant. Missing setup returns `chess/missing-setup`, rather than silently selecting the orthodox array. Ordinary PGN without setup headers retains its usual starting position. |

The PGN specification section 9.7.1 requires FEN when `SetUp` is `1`. Requiring FEN for an explicit Chess960 variant is our import policy, including the orthodox array played as Chess960. This avoids guessing the intended starting array. The dependency's other permissive variant aliases are not promoted to a project guarantee by this change.

Still pending: explicit ruleset identity in contracts and playback targets; negative validation for declarations claiming a complete initial array; external FEN imports and conflict diagnostics; general ambiguous-rights handling; setup-header alias/conflict policy; canonical PGN export and transformation reports. Passing this corpus does not ratify those proposals or independently prove all castling legality. The Go research probes provide corroboration for several geometries, not exhaustive differential validation.

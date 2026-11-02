# Experiment 002 — One reader, two editorial forms

The current prototype uses the original visual design, React/Vite+, Tailwind CSS, Valibot and XState Store. This experiment supplements the earlier Morphy-attributed problem proposal; it does not claim that the historical attribution work for Experiment 001 has been completed.

## Implemented examples

| Artifact                                       | Interaction                          | Verification                                                                  |
| ---------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------- |
| Carpenter, Dubuque Chess Journal, October 1873 | Quiet key and final mate checkpoints | Legal score; every defense after the intended key is covered and ends in mate |
| Réti, 11 September 1921                        | First-move prompt and published line | Legal selected variation; full solution-tree soundness remains unverified     |
| Morphy consultation / Opera Game, 1858         | Two move-guessing checkpoints        | Legal complete score; terminal checkmate                                      |
| Réti–Tartakower, Vienna 1910                   | Queen-offer checkpoint               | Legal recorded score; ends at resignation, not an invented played checkmate   |

The lesson reader uses the same session events for all four. Artifacts retain their type, source, score and stipulation; narratives supply separate prompts, hints and interpretation. Canonical prompt anchors are paths of legal UCI moves rather than display move numbers.

## Boundaries

No backend, accounts, ratings, streaks, AI tutor or engine service. Use authored accepted moves; do not label every alternative legal move objectively losing. Readers can drag pieces or click a piece and destination throughout the recorded line, including between checkpoints. They can also skip prompts, reveal, rewind, flip the board or open optional SAN/coordinate keyboard entry. Coordinate promotion suffixes support underpromotion.

PGN import/export preserves tags, comments, NAGs, FEN setup and variations. All parsed branches are checked for legal moves; playback currently selects the mainline. chessops tolerates malformed tokens, so imported notation still needs source comparison before editorial use. FEN imports are position-only. Lesson JSON is schema-validated and preserves the prompts. EPD and composition-specific formats are researched but not claimed as implemented.

## Evidence

Automated tests cover score legality, checkpoints, hints, reveal/reset/skip, wrong-move handling, PGN branch/comment round-trips and resignation semantics. Browser QA verified lesson opening, hints, keyboard move submission, dragging, click-to-move between checkpoints, and file-coordinate alignment in both orientations. Automated import/export tests pass; import UI and mobile touch checks remain open. The experience still needs independent chess/editorial review and mobile/touch evaluation.

## Next tracer bullets

1. Expose variation navigation using stable paths without flattening alternate defenses into recorded game moves.
2. Cross-check the complete Réti tree, and independently review the Carpenter key's uniqueness.
3. Import one rights-cleared FIDE Album endgame study with page/problem identifiers and correction history.
4. Decide whether concurrent lesson/media/import workflows justify an XState statechart. Keep XState Store until that complexity actually exists.

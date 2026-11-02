# Lichess lesson formats and our adaptation

Inspected upstream source on 2 November 2026. No Lichess controller code was copied.

## Three useful options

| Approach                      | Evidence                                                                                                                                                                                                                         | Fit for Chess Anthology                                                                                                                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adopt Learn scenarios         | [Level types](https://github.com/lichess-org/lila/blob/master/ui/learn/src/stage/list.ts) and [scenario runner](https://github.com/lichess-org/lila/blob/master/ui/learn/src/scenario.ts)                                        | Levels carry FEN, goals, optional scripted moves/shapes, and executable success/failure predicates. Useful for teaching board mechanics, but not a portable historical narrative format.                                          |
| Extract Study gamebooks       | [Play controller](https://github.com/lichess-org/lila/blob/master/ui/analyse/src/study/gamebook/gamebookPlayCtrl.ts) and [editor](https://github.com/lichess-org/lila/blob/master/ui/analyse/src/study/gamebook/gamebookEdit.ts) | Closest model: comments belong to positions reached in a move tree; nodes have hint/deviation metadata. The implementation depends on Lichess's analysis controller, study state, tree library, redraw and socket infrastructure. |
| Adapt the ideas in our reader | PGN + ordered, typed annotations at chess anchors                                                                                                                                                                                | Selected. Keep Chessground and chessops, our React/XState Store session and a small Valibot contract. Reuse concepts without importing a second application framework.                                                            |

The Study controller distinguishes mainline and deviation states, can show node comments or generic deviation text, and can retry automatically after a short delay when no comment is present. We deliberately keep a try visible until the reader chooses Retry, Undo, Reveal or another timeline position. The runtime does not label an off-line move as objectively bad.

The Learn scenario representation can interleave moves with board shapes. This supports the broader idea of attaching structured information to a move, but it is not a standalone lesson-file standard. A universal adapter for Learn or Study data is not implemented here.

## Implemented format

PGN remains the chess record. A versioned JSON document contains that PGN and narrative events. A text event or prompt is appended after its indexed position. Events at the same position retain their authored array order. Use ply zero for the initial position, ply one after White's first move, ply two after Black's first move, and so on. A legal normalized move path can replace the numeric anchor.

This is a small prototype contract validated against our two compositions and two games, not a claim to cover every chess composition genre. The authoring reference is [lesson-format.md](../lesson-format.md).

## Feedback policy

- Apply a legal try to a temporary board position, without modifying the source PGN or advancing the recorded cursor.
- Pause continuation of that temporary line. Do not invent a reply or snap the piece back on a timer.
- Use **“Try again.”** when no authored interpretation exists.
- More specific encouragement is attached to an explicit legal move at an explicit prompt. There is no heuristic claim that moving the same piece means the reader has understood the theme.
- The Carpenter example annotates Qg3 as a quiet queen move: it shares that property with the key Qh3, without satisfying the intended line. The message validates the observed idea and suggests another square.
- An illegal keyboard input receives a short legal-move instruction; the position stays unchanged.
- Retry restores the original position and keeps revealed hints. Reveal restores the original position and displays the authored idea. A correct move rejoins the recorded line.

Lichess's application source and standalone libraries have separate licenses; see [Lila licensing](https://github.com/lichess-org/lila/blob/master/COPYING.md) and our third-party notices. Source inspection does not make a controller a drop-in React library.

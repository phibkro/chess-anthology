# Lesson document, version 1

The canonical document is JSON. `src/lesson/schema.ts` is its Valibot contract; `compileLesson` validates the chess record and annotation anchors. The UI derives a sequence of moves and annotations from the document.

```json
{
  "formatVersion": 1,
  "id": "carpenter",
  "artifact": {
    "kind": "composition",
    "pgn": "[SetUp \"1\"]\n[FEN \"8/8/3K4/8/3k4/5Q2/2R5/8 w - - 0 1\"]\n\n1. Qh3 Ke4 2. Rc4# *",
    "stipulation": "White to play and mate in two",
    "source": {
      "title": "WFCC · Chess Compositions",
      "url": "https://www.wfcc.ch/chess-compositions/",
      "note": "Dubuque Chess Journal, October 1873; George Edward Carpenter."
    }
  },
  "narrative": {
    "title": "A quiet key",
    "subtitle": "George Edward Carpenter · 1873",
    "introduction": "Four pieces and a mate in two.",
    "events": [
      {
        "id": "find-the-key",
        "type": "prompt",
        "after": 0,
        "prompt": "Find the quiet first move.",
        "hints": ["Begin without check.", "Move the queen along its rank."],
        "accepted": ["f3h3"],
        "explanation": "Qh3 leaves only …Ke4, followed by Rc4 mate.",
        "feedback": [
          {
            "move": "f3g3",
            "message": "Good try! You have the right idea with a quiet queen move. Try another square on this rank."
          }
        ]
      },
      {
        "id": "after-the-key",
        "type": "text",
        "after": 1,
        "text": "The black king now has only one legal reply."
      }
    ]
  }
}
```

## Anchors and order

| Anchor                      | Meaning                                                          |
| --------------------------- | ---------------------------------------------------------------- |
| `"after": 0`                | After setup, before the first move                               |
| `"after": 1`                | After the first half-move                                        |
| `"after": 2`                | After the second half-move                                       |
| `"after": ["f3h3", "d4e4"]` | After this legal move path from the artifact's starting position |

Numeric anchors are **plies**, not full move numbers. The field is named `after`; there is no implicit before/after ambiguity. A prompt after ply 2 asks about the next move from that position. Path anchors use the compiler's chessops-normalized coordinate moves; castling follows that representation. Both forms resolve to the same validated mainline frames.

Annotations at one anchor retain array order. Text appears after the associated move in the score and at the current position in the reading pane. Prompt hints remain optional. Initial text events use anchor zero.

## Validation

- IDs are unique within a lesson. Every annotation must resolve to a position.
- At most one prompt occupies a position. A prompt requires hints and an accepted move matching the recorded next move in this prototype.
- Authored alternative feedback must name a unique legal move at that position, distinct from the accepted move.
- The complete parsed PGN tree is checked for legal moves. Branch playback and multi-answer continuations remain future work.
- Unknown format versions and annotation types are rejected.
- Unversioned lessons with `narrative.checkpoints` are migrated on import. Exports use version 1 and `narrative.events`.

## Source record versus reader session

A reader's try stores a temporary position and SAN/UCI move. It does not enter the artifact PGN or its move history. The recorded cursor remains at the prompt anchor until the reader retries or explicitly navigates away. Continuation of the temporary line is paused.

Lesson JSON export preserves annotations, hints and move-specific feedback. PGN export preserves the original chess record and PGN comments/variations, but does not encode lesson-specific JSON events. FEN export describes the position currently displayed, including a try. A future PGN adapter may embed structured annotations, but no undocumented comment directive is introduced here.

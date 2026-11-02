import { useCallback, useState, useSyncExternalStore } from "react";
import { parseSan } from "chessops/san";
import { makeUci } from "chessops/util";
import { openingFor } from "./openings";
import { Board } from "./Board";
import { checkpointAt, createLessonStore } from "./store";
import { exportPgn, positionFromFen, type CompiledLesson } from "./chess";

function saveText(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function Reader({ lesson }: { lesson: CompiledLesson }) {
  const [store] = useState(() => createLessonStore(lesson));
  const subscribe = useCallback(
    (listener: () => void) => {
      const sub = store.subscribe(listener);
      return () => sub.unsubscribe();
    },
    [store],
  );
  const context = useSyncExternalStore(subscribe, () => store.getSnapshot().context);
  const [moveText, setMoveText] = useState("");
  const [promotion, setPromotion] = useState("q");
  const { cursor, hints, feedback, revealed, practice, orientation } = context;
  const frame = lesson.frames[cursor];
  const checkpoint = checkpointAt(context);
  const interactive = Boolean(checkpoint && practice);
  const submit = useCallback(
    (text: string) => {
      const pos = positionFromFen(
        store.getSnapshot().context.lesson.frames[store.getSnapshot().context.cursor].fen,
      );
      const san = parseSan(pos, text.trim());
      store.trigger.submit({ uci: san ? makeUci(san) : text.trim() });
      setMoveText("");
    },
    [store],
  );
  const opening = openingFor(lesson);
  const finished = cursor === lesson.frames.length - 1;
  return (
    <div className="lesson-reader">
      <div className="lesson-heading">
        <p className="eyebrow">
          {lesson.content.artifact.kind === "composition"
            ? "THE ART OF CHESS COMPOSITION"
            : "CHESS THROUGH THE TIMES"}
        </p>
        <h2>{lesson.content.narrative.title}</h2>
        <p className="lesson-subtitle">{lesson.content.narrative.subtitle}</p>
        {opening && (
          <p className="opening-tag">
            {opening.eco} · {opening.name}
          </p>
        )}
      </div>
      <div className="lesson-layout">
        <div className="board-column">
          <Board
            fen={frame.fen}
            orientation={orientation}
            interactive={interactive}
            attempt={context.attempts}
            promotion={promotion}
            onMove={submit}
          />
          <div className="playback">
            <button aria-label="Reset lesson" onClick={() => store.trigger.reset()}>
              ↺
            </button>
            <button
              aria-label="Previous move"
              disabled={cursor === 0}
              onClick={() => store.trigger.previous()}
            >
              ←
            </button>
            <span>
              {cursor === 0
                ? "Starting position"
                : `${Math.ceil(cursor / 2)}${cursor % 2 ? "." : "…"} ${frame.san}`}
            </span>
            <button aria-label="Next move" disabled={finished} onClick={() => store.trigger.next()}>
              →
            </button>
            <button aria-label="Flip board" onClick={() => store.trigger.flip()}>
              ⇅
            </button>
          </div>
          <div className="progress-track">
            <div
              style={{
                width: `${lesson.frames.length > 1 ? (cursor / (lesson.frames.length - 1)) * 100 : 0}%`,
              }}
            />
          </div>
          <div className="reader-mode">
            <label>
              <input
                type="checkbox"
                checked={practice}
                onChange={() => store.trigger.togglePractice()}
              />{" "}
              Pause & try
            </label>
            <span>
              {cursor} / {lesson.frames.length - 1} plies
            </span>
          </div>
          {interactive && (
            <form
              className="move-form"
              onSubmit={(event) => {
                event.preventDefault();
                submit(moveText);
              }}
            >
              <label htmlFor="move-input">
                Your move <small>SAN or coordinates</small>
              </label>
              <div>
                <input
                  id="move-input"
                  autoComplete="off"
                  value={moveText}
                  onChange={(event) => setMoveText(event.target.value)}
                  placeholder="Qh3 or f3h3"
                />
                <button type="submit" disabled={!moveText.trim()}>
                  Play
                </button>
              </div>
              <label className="promotion">
                Promote to
                <select
                  aria-label="Promotion piece"
                  value={promotion}
                  onChange={(event) => setPromotion(event.target.value)}
                >
                  <option value="q">Queen</option>
                  <option value="r">Rook</option>
                  <option value="b">Bishop</option>
                  <option value="n">Knight</option>
                </select>
              </label>
            </form>
          )}
        </div>
        <div className="narrative-column">
          <p className="lesson-intro">{lesson.content.narrative.introduction}</p>
          {lesson.content.artifact.stipulation && (
            <p className="stipulation">{lesson.content.artifact.stipulation}</p>
          )}
          {interactive ? (
            <section className="checkpoint">
              <p className="eyebrow">YOUR TURN</p>
              <h3>{checkpoint?.prompt}</h3>
              {checkpoint?.hints.slice(0, hints).map((hint, index) => (
                <p className="hint" key={hint}>
                  <span>{index + 1}</span>
                  {hint}
                </p>
              ))}
              <div className="hint-actions">
                <button
                  disabled={hints >= (checkpoint?.hints.length ?? 0)}
                  onClick={() => store.trigger.hint()}
                >
                  Hint {hints}/{checkpoint?.hints.length}
                </button>
                <button onClick={() => store.trigger.reveal()}>Reveal</button>
                <button onClick={() => store.trigger.next()}>Skip →</button>
              </div>
              {revealed && (
                <p className="revealed">
                  Selected move: <strong>{lesson.frames[cursor + 1]?.san}</strong>
                </p>
              )}
            </section>
          ) : (
            <section className="checkpoint">
              <p className="eyebrow">
                {finished ? "END OF THE SELECTED LINE" : "FOLLOW THE POSITION"}
              </p>
              <h3>
                {finished
                  ? positionFromFen(frame.fen).isCheckmate()
                    ? "Checkmate."
                    : "The score ends here."
                  : "Replay at your own pace."}
              </h3>
              <p>
                {frame.comment ||
                  (finished
                    ? "Rewind to revisit an idea, or choose another work."
                    : "Use the arrows or select a move below. Prompts are optional.")}
              </p>
            </section>
          )}
          <p className="move-feedback" aria-live="polite">
            {feedback}
          </p>
          {lesson.content.narrative.checkpoints.length > 0 && (
            <div className="checkpoint-jumps">
              <span>Decisions</span>
              {lesson.content.narrative.checkpoints.map((point, index) => (
                <button
                  key={point.path.join(" ")}
                  onClick={() => store.trigger.seek({ cursor: point.path.length })}
                >
                  {index + 1} ↗
                </button>
              ))}
            </div>
          )}
          <details className="score" open>
            <summary>Move score</summary>
            <div className="move-list">
              <button
                className={cursor === 0 ? "current" : ""}
                onClick={() => store.trigger.seek({ cursor: 0 })}
              >
                Start
              </button>
              {lesson.frames.slice(1).map((item, index) => (
                <button
                  key={index}
                  aria-current={cursor === index + 1 ? "step" : undefined}
                  className={cursor === index + 1 ? "current" : ""}
                  onClick={() => store.trigger.seek({ cursor: index + 1 })}
                >
                  {index % 2 === 0 && <small>{Math.floor(index / 2) + 1}.</small>}
                  {item.san}
                </button>
              ))}
            </div>
          </details>
          <details className="lesson-source">
            <summary>Sources & notation</summary>
            <a target="_blank" rel="noreferrer" href={lesson.content.artifact.source.url}>
              {lesson.content.artifact.source.title} ↗
            </a>
            <p>{lesson.content.artifact.source.note}</p>
            <div className="exports">
              <button
                onClick={() =>
                  saveText(`${lesson.content.id}.pgn`, exportPgn(lesson), "application/x-chess-pgn")
                }
              >
                Export PGN ↓
              </button>
              <button
                onClick={() =>
                  saveText(
                    `${lesson.content.id}.json`,
                    JSON.stringify(lesson.content, null, 2),
                    "application/json",
                  )
                }
              >
                Lesson JSON ↓
              </button>
              <button onClick={() => saveText(`${lesson.content.id}.fen`, frame.fen, "text/plain")}>
                Position FEN ↓
              </button>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

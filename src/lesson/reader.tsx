import { parseSan } from "chessops/san";
import { makeUci } from "chessops/util";
import { Fragment, useCallback, useState, useSyncExternalStore } from "react";

import { Board } from "./board";
import { eventsAt, exportPgn, positionFromFen } from "./chess";
import type { CompiledLesson } from "./chess";
import { openingFor } from "./openings";
import { checkpointAt, createLessonStore } from "./store";

const moveLabel = (
  attempt: string | undefined,
  cursor: number,
  san: string
): string => {
  if (attempt !== undefined) {
    return `Your try: ${attempt}`;
  }
  if (cursor === 0) {
    return "Starting position";
  }
  return `${Math.ceil(cursor / 2)}${cursor % 2 === 1 ? "." : "…"} ${san}`;
};
const saveText = (filename: string, text: string, type: string) => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
};
const PositionNotes = ({
  lesson,
  cursor,
  compact = false,
}: {
  lesson: CompiledLesson;
  cursor: number;
  compact?: boolean;
}) => (
  <>
    {eventsAt(lesson, cursor).map(({ event }) =>
      event.type === "text" ? (
        <p key={event.id} className={compact ? "score-note" : "position-note"}>
          {event.text}
        </p>
      ) : null
    )}
  </>
);
type LessonSession = ReturnType<typeof createLessonStore>;
type LessonSessionContext = ReturnType<LessonSession["getSnapshot"]>["context"];
const endingTitle = (fen: string, finished: boolean): string => {
  if (!finished) {
    return "Replay at your own pace.";
  }
  return positionFromFen(fen).isCheckmate()
    ? "Checkmate."
    : "The score ends here.";
};
const LessonScore = ({
  lesson,
  cursor,
  store,
}: {
  lesson: CompiledLesson;
  cursor: number;
  store: LessonSession;
}) => (
  <details className="score" open>
    <summary>Move score</summary>
    <div className="move-list">
      <button
        type="button"
        className={cursor === 0 ? "current" : ""}
        onClick={() => {
          store.trigger.seek({ cursor: 0 });
        }}
      >
        Start
      </button>
      <PositionNotes lesson={lesson} cursor={0} compact />
      {lesson.frames.slice(1).map((item, index) => (
        <Fragment key={item.path.join(" ")}>
          <button
            type="button"
            key={index}
            aria-current={cursor === index + 1 ? "step" : undefined}
            className={cursor === index + 1 ? "current" : ""}
            onClick={() => {
              store.trigger.seek({ cursor: index + 1 });
            }}
          >
            {index % 2 === 0 && <small>{Math.floor(index / 2) + 1}.</small>}
            {item.san}
          </button>
          <PositionNotes lesson={lesson} cursor={index + 1} compact />
        </Fragment>
      ))}
    </div>
  </details>
);
const LessonCheckpoint = ({
  lesson,
  context,
  store,
}: {
  lesson: CompiledLesson;
  context: LessonSessionContext;
  store: LessonSession;
}) => {
  const { cursor, hints, revealed, attempt, practice } = context;
  const checkpoint = checkpointAt(context);
  const promptActive = Boolean(checkpoint && practice);
  const frame = lesson.frames[cursor];
  const finished = cursor === lesson.frames.length - 1;
  return promptActive ? (
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
          type="button"
          disabled={hints >= (checkpoint?.hints.length ?? 0)}
          onClick={() => {
            store.trigger.hint();
          }}
        >
          Hint {hints}/{checkpoint?.hints.length}
        </button>
        <button
          type="button"
          onClick={() => {
            store.trigger.reveal();
          }}
        >
          Reveal
        </button>
        <button
          type="button"
          disabled={Boolean(attempt)}
          onClick={() => {
            store.trigger.next();
          }}
        >
          Skip →
        </button>
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
      <h3>{endingTitle(frame.fen, finished)}</h3>
      <p>
        {frame.comment ||
          (finished
            ? "Rewind to revisit an idea, or choose another work."
            : "Use the arrows or select a move below. Prompts are optional.")}
      </p>
    </section>
  );
};
const LessonNarrative = ({
  lesson,
  context,
  store,
}: {
  lesson: CompiledLesson;
  context: LessonSessionContext;
  store: LessonSession;
}) => {
  const { cursor, feedback, revealed, practice, attempt, feedbackTone } =
    context;
  const frame = lesson.frames[cursor];
  const displayedFen = attempt?.fen ?? frame.fen;
  const checkpoint = checkpointAt(context);
  const promptActive = Boolean(checkpoint && practice);
  const decisions = lesson.events.filter(
    ({ event }) => event.type === "prompt"
  );
  return (
    <div className="narrative-column">
      <p className="lesson-intro">{lesson.content.narrative.introduction}</p>
      {lesson.content.artifact.stipulation !== undefined && (
        <p className="stipulation">{lesson.content.artifact.stipulation}</p>
      )}
      <PositionNotes lesson={lesson} cursor={cursor} />
      <LessonCheckpoint lesson={lesson} context={context} store={store} />
      {attempt && (
        <section className="try-panel">
          <h3>Your try: {attempt.san}</h3>
          <div className="try-actions">
            <button
              type="button"
              onClick={() => {
                store.trigger.retry();
              }}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => {
                store.trigger.reveal();
              }}
            >
              Reveal the idea
            </button>
          </div>
        </section>
      )}
      {revealed && !promptActive && (
        <p className="revealed">
          Recorded move: <strong>{lesson.frames[cursor + 1]?.san}</strong>
        </p>
      )}
      <p className="move-feedback" data-tone={feedbackTone} aria-live="polite">
        {feedback}
      </p>
      {decisions.length > 0 && (
        <div className="checkpoint-jumps">
          <span>Decisions</span>
          {decisions.map((point, index) => (
            <button
              type="button"
              key={point.event.id}
              onClick={() => {
                store.trigger.seek({ cursor: point.cursor });
              }}
            >
              {index + 1} ↗
            </button>
          ))}
        </div>
      )}
      <LessonScore lesson={lesson} cursor={cursor} store={store} />
      <details className="lesson-source">
        <summary>Sources & notation</summary>
        <a
          target="_blank"
          rel="noreferrer"
          href={lesson.content.artifact.source.url}
        >
          {lesson.content.artifact.source.title} ↗
        </a>
        <p>{lesson.content.artifact.source.note}</p>
        <div className="exports">
          <button
            type="button"
            onClick={() => {
              saveText(
                `${lesson.content.id}.pgn`,
                exportPgn(lesson),
                "application/x-chess-pgn"
              );
            }}
          >
            Export PGN ↓
          </button>
          <button
            type="button"
            onClick={() => {
              saveText(
                `${lesson.content.id}.json`,
                JSON.stringify(lesson.content, null, 2),
                "application/json"
              );
            }}
          >
            Lesson JSON ↓
          </button>
          <button
            type="button"
            onClick={() => {
              saveText(`${lesson.content.id}.fen`, displayedFen, "text/plain");
            }}
          >
            Position FEN ↓
          </button>
        </div>
      </details>
    </div>
  );
};
/**
 * Render recorded play, annotations and optional reader practice.
 * @param props - Component inputs and event callbacks.
 * @returns Render recorded play, annotations and optional reader practice.
 */
export const Reader = ({ lesson }: { lesson: CompiledLesson }) => {
  const [session, setSession] = useState(() => ({
    lesson,
    store: createLessonStore(lesson),
  }));
  if (session.lesson !== lesson) {
    setSession({ lesson, store: createLessonStore(lesson) });
  }
  const { store } = session;
  const subscribe = useCallback(
    (listener: () => void) => {
      const sub = store.subscribe(listener);
      return () => {
        sub.unsubscribe();
      };
    },
    [store]
  );
  const context = useSyncExternalStore(
    subscribe,
    () => store.getSnapshot().context
  );
  const [moveText, setMoveText] = useState("");
  const [promotion, setPromotion] = useState("q");
  const { cursor, practice, orientation, attempt } = context;
  const frame = lesson.frames[cursor];
  const displayedFen = attempt?.fen ?? frame.fen;
  const interactive = !attempt && cursor < lesson.frames.length - 1;
  const submit = useCallback(
    (text: string) => {
      const pos = positionFromFen(
        store.getSnapshot().context.lesson.frames[
          store.getSnapshot().context.cursor
        ].fen
      );
      const san = parseSan(pos, text.trim());
      store.trigger.submit({ uci: san ? makeUci(san) : text.trim() });
      setMoveText("");
    },
    [store]
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
            fen={displayedFen}
            orientation={orientation}
            interactive={interactive}
            attempt={context.attempts}
            paused={Boolean(attempt)}
            promotion={promotion}
            onMove={submit}
          />
          <div className="playback">
            <button
              type="button"
              aria-label="Reset lesson"
              onClick={() => {
                store.trigger.reset();
              }}
            >
              ↺
            </button>
            <button
              type="button"
              aria-label={attempt ? "Undo try" : "Previous move"}
              disabled={cursor === 0 && !attempt}
              onClick={() => {
                store.trigger.previous();
              }}
            >
              ←
            </button>
            <span>{moveLabel(attempt?.san, cursor, frame.san)}</span>
            <button
              type="button"
              aria-label="Next move"
              disabled={finished || Boolean(attempt)}
              onClick={() => {
                store.trigger.next();
              }}
            >
              →
            </button>
            <button
              type="button"
              aria-label="Flip board"
              onClick={() => {
                store.trigger.flip();
              }}
            >
              ⇅
            </button>
          </div>
          <progress
            className="progress-track"
            value={cursor}
            max={Math.max(1, lesson.frames.length - 1)}
            aria-label="Recorded move progress"
          />
          <div className="reader-mode">
            <label>
              <input
                type="checkbox"
                checked={practice}
                onChange={() => {
                  store.trigger.togglePractice();
                }}
              />{" "}
              Pause & try
            </label>
            <span>
              {cursor} / {lesson.frames.length - 1} plies
            </span>
          </div>
          {interactive && (
            <>
              <p className="board-help">
                Drag a piece, or click it and then its destination.
              </p>
              <details className="keyboard-entry">
                <summary>Keyboard move entry</summary>
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
                      onChange={(event) => {
                        setMoveText(event.target.value);
                      }}
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
                      onChange={(event) => {
                        setPromotion(event.target.value);
                      }}
                    >
                      <option value="q">Queen</option>
                      <option value="r">Rook</option>
                      <option value="b">Bishop</option>
                      <option value="n">Knight</option>
                    </select>
                  </label>
                </form>
              </details>
            </>
          )}
        </div>
        <LessonNarrative lesson={lesson} context={context} store={store} />
      </div>
    </div>
  );
};

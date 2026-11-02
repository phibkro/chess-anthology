import { parsePlaybackPlan } from "chess-compiler-prototype/playback";
import { parseSan } from "chessops/san";
import { makeUci } from "chessops/util";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import planData from "../content/generated/queen-offers.json";
import { Board, positionFromFen } from "../lesson";
import { createStoryStore } from "./store";
const parsed = parsePlaybackPlan(planData);
const credits: Record<
  string,
  { title: string; detail: string; url: string; source: string }
> = {
  opera: {
    title: "The Opera Game",
    detail: "Paul Morphy · Duke Karl & Count Isouard · Paris, 1858",
    url: "https://lichess.org/study/sDu58CyZ/vPCEzYiV",
    source: "Recorded game and source trail",
  },
  reti: {
    title: "Réti–Tartakower",
    detail: "Richard Réti · Savielly Tartakower · Vienna, 1910",
    url: "https://www.screti.ch/index.php/news-reader/richard-retis-sieg-im-wiener-tagblatt.html",
    source: "Historical score and source trail",
  },
};
export function StoryReader() {
  if (!parsed.ok) return <p role="alert">This story could not be loaded.</p>;
  return <PlayableStory plan={parsed.value} />;
}
function PlayableStory({
  plan,
}: {
  plan: import("chess-compiler-prototype/playback").PlaybackPlan;
}) {
  const [store] = useState(() => createStoryStore(plan));
  const subscribe = useCallback(
    (listener: () => void) => {
      const sub = store.subscribe(listener);
      return () => sub.unsubscribe();
    },
    [store]
  );
  const context = useSyncExternalStore(
    subscribe,
    () => store.getSnapshot().context
  );
  const [move, setMove] = useState("");
  const scene = plan.scenes[context.scene];
  const frame = scene.frames[context.ply];
  const prompt = scene.notes.find((note) => note.type === "prompt");
  const atPrompt = context.ply === scene.after;
  const arrows = useMemo(
    () =>
      !context.attempt && (context.revealed || context.ply === scene.after + 1)
        ? scene.notes.filter((n) => n.type === "arrow")
        : [],
    [scene, context.revealed, context.ply, context.attempt]
  );
  const submit = useCallback(
    (uci: string) => store.trigger.submit({ uci }),
    [store]
  );
  const select = (index: number) => {
    setMove("");
    store.trigger.selectScene({ index });
  };
  return (
    <div className="lesson-reader story-reader">
      <div className="lesson-heading">
        <p className="eyebrow">TWO GAMES · ONE IDEA</p>
        <h2>A queen offered, a mating net.</h2>
        <p className="lesson-subtitle">Morphy in Paris. Réti in Vienna.</p>
      </div>
      <nav className="story-scenes" aria-label="Story examples">
        {plan.scenes.map((item, index) => (
          <button
            key={item.id}
            aria-current={index === context.scene ? "step" : undefined}
            onClick={() => select(index)}
          >
            {index + 1}. {credits[item.game]?.title ?? item.game}
          </button>
        ))}
      </nav>
      <div className="lesson-layout">
        <div className="board-column">
          <Board
            fen={context.attempt?.fen ?? frame.fen}
            orientation={context.orientation}
            interactive={
              !context.attempt && context.ply < scene.frames.length - 1
            }
            attempt={context.attempts}
            paused={Boolean(context.attempt)}
            promotion="q"
            onMove={submit}
            arrows={arrows}
          />
          <div className="playback">
            <button
              aria-label="Return to the story position"
              onClick={() => store.trigger.restart()}
            >
              ↺
            </button>
            <button
              aria-label="Previous move"
              disabled={!context.attempt && context.ply === 0}
              onClick={() => store.trigger.previous()}
            >
              ←
            </button>
            <span>
              {frame.san
                ? `${Math.ceil(context.ply / 2)}${context.ply % 2 ? "." : "…"} ${frame.san}`
                : "Starting position"}
            </span>
            <button
              aria-label="Next move"
              disabled={
                Boolean(context.attempt) ||
                context.ply === scene.frames.length - 1
              }
              onClick={() => store.trigger.next()}
            >
              →
            </button>
            <button
              aria-label="Flip board"
              onClick={() => store.trigger.flip()}
            >
              ⇅
            </button>
          </div>
          <details className="keyboard-entry">
            <summary>Type a move</summary>
            <form
              className="move-form"
              onSubmit={(event) => {
                event.preventDefault();
                const position = positionFromFen(frame.fen);
                const san = parseSan(position, move.trim());
                submit(san ? makeUci(san) : move.trim());
                setMove("");
              }}
            >
              <label htmlFor="story-move">Your move</label>
              <div>
                <input
                  id="story-move"
                  value={move}
                  onChange={(event) => setMove(event.target.value)}
                  placeholder="SAN or coordinates"
                />
                <button
                  disabled={!move.trim() || Boolean(context.attempt)}
                  type="submit"
                >
                  Play
                </button>
              </div>
            </form>
          </details>
        </div>
        <div className="narrative-column">
          <p className="eyebrow">
            EXAMPLE {context.scene + 1} / {plan.scenes.length}
          </p>
          <h3>{credits[scene.game]?.title}</h3>
          <p className="lesson-subtitle">{credits[scene.game]?.detail}</p>
          {scene.notes
            .filter((n) => n.type === "text")
            .map((note, index) => (
              <p key={index} className="lesson-intro">
                {note.text}
              </p>
            ))}
          <section className="checkpoint">
            <p className="eyebrow">
              {atPrompt ? "YOUR TURN" : "FOLLOW THE GAME"}
            </p>
            <h3>
              {atPrompt && prompt?.type === "prompt"
                ? prompt.text
                : context.ply === scene.frames.length - 1
                  ? "The recorded score ends here."
                  : "Replay at your own pace."}
            </h3>
            {atPrompt && prompt?.type === "prompt" && (
              <div className="hint-actions">
                <button onClick={() => store.trigger.reveal()}>
                  Reveal the idea
                </button>
                <button
                  disabled={Boolean(context.attempt)}
                  onClick={() => store.trigger.next()}
                >
                  Skip →
                </button>
              </div>
            )}
            {context.revealed && prompt?.type === "prompt" && (
              <p className="revealed">
                Selected move: <strong>{prompt.answer}</strong>
              </p>
            )}
          </section>
          {context.attempt && (
            <section className="try-panel">
              <h3>Your try: {context.attempt.san}</h3>
              <button onClick={() => store.trigger.retry()}>Try again</button>
            </section>
          )}
          {context.feedback && (
            <p
              className="move-feedback"
              role="status"
              data-tone={context.success ? "success" : "neutral"}
            >
              {context.feedback}
            </p>
          )}
          <div className="story-next">
            <button
              disabled={context.scene === 0}
              onClick={() => select(context.scene - 1)}
            >
              ← Previous example
            </button>
            <button
              disabled={context.scene === plan.scenes.length - 1}
              onClick={() => select(context.scene + 1)}
            >
              Next example →
            </button>
          </div>
          <a
            className="text-link"
            href={credits[scene.game]?.url}
            target="_blank"
            rel="noreferrer"
          >
            {credits[scene.game]?.source} ↗
          </a>
        </div>
      </div>
    </div>
  );
}

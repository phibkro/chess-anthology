import { StoryReader } from "./story";
import { useEffect, useRef, useState } from "react";
import collection from "./collection.json";
import lessonData from "./content/lessons.json";
import { Reader, compileLesson, importPgn, importFen, type CompiledLesson } from "./lesson";

const lessons = lessonData.map(compileLesson);
function HeroBoard() {
  const position: Record<string, string> = { h8: "♚", c6: "♟", a6: "♚", h5: "♟" };
  return (
    <div
      className="board hero-board"
      role="img"
      aria-label="Réti study: white king h8 and pawn c6; black king a6 and pawn h5"
    >
      {Array.from({ length: 64 }, (_, index) => {
        const file = index % 8;
        const rank = 8 - Math.floor(index / 8);
        const square = String.fromCharCode(97 + file) + rank;
        return (
          <div key={square} className={`square ${(file + rank) % 2 === 1 ? "dark" : ""}`}>
            <span className={["h8", "c6"].includes(square) ? "piece-white" : "piece-black"}>
              {position[square]}
            </span>
            {(rank === 1 || file === 0) && (
              <span className="coord">
                {file === 0 ? rank : ""}
                {rank === 1 ? String.fromCharCode(97 + file) : ""}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
export function App() {
  const [field, setField] = useState("all");
  const [search, setSearch] = useState("");
  const [era, setEra] = useState("all");
  const [storyOpen, setStoryOpen] = useState(false);
  const [active, setActive] = useState<CompiledLesson | null>(null);
  const [entry, setEntry] = useState<(typeof collection.entries)[number] | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [format, setFormat] = useState("pgn");
  const [error, setError] = useState("");
  const reader = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (active || entry || importOpen || storyOpen) reader.current?.showModal();
    else reader.current?.close();
  }, [active, entry, importOpen, storyOpen]);
  function close() {
    setStoryOpen(false);
    setActive(null);
    setEntry(null);
    setImportOpen(false);
  }
  function openLesson(id: string) {
    const lesson = lessons.find((item) => item.content.id === id);
    if (lesson) {
      setEntry(null);
      setImportOpen(false);
      setActive(lesson);
    }
  }
  function filter(value: string) {
    setField(value);
    document.getElementById("collection")?.scrollIntoView({ behavior: "smooth" });
  }
  const entries = collection.entries.filter(
    (item) =>
      (field === "all" || item.field === field) &&
      (era === "all" || item.era === era) &&
      JSON.stringify([item.title, item.person, item.place, item.cluster])
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <>
      <a className="skip" href="#collection">
        Skip to the collection
      </a>
      <header>
        <a className="brand" href="#">
          <span className="brand-symbol">♞</span>
          <span>
            CHESS
            <br />
            ANTHOLOGY
          </span>
        </a>
        <nav aria-label="Main navigation">
          <button onClick={() => filter("composition")}>The art of composition</button>
          <button onClick={() => filter("history")}>Chess through the times</button>
          <a href="#lessons">Interactive lessons ↗</a>
        </nav>
        <span className="edition">AN OPENING COLLECTION · VOL. 01</span>
      </header>
      <main>
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="red-dot" /> SIXTY-FOUR SQUARES. COUNTLESS HUMAN STORIES.
            </p>
            <h1>
              The game is only
              <br />
              half the <em>story.</em>
            </h1>
            <p className="intro">
              A living anthology of chess as art, culture and human experience. Meet the people,
              ideas and communities that make the board come alive.
            </p>
            <button className="primary" onClick={() => openLesson("reti")}>
              Enter a lesson <span>↗</span>
            </button>
            <div className="hero-foot">
              <span>PLAYERS & COMPOSERS</span>
              <span>PLACES & COMMUNITIES</span>
              <span>IDEAS & ERAS</span>
            </div>
          </div>
          <figure className="hero-art">
            <div className="art-top">
              FIG. 01 <span>AN IDEA IN FOUR PIECES</span>
            </div>
            <HeroBoard />
            <figcaption>
              <span>Richard Réti, 1921</span>
              <button onClick={() => openLesson("reti")}>Discover the study ↗</button>
            </figcaption>
          </figure>
        </section>
        <section className="paths" aria-label="The two fields">
          <button className="path" onClick={() => filter("composition")}>
            <span className="path-number">I.</span>
            <span>
              <span className="eyebrow">CHESS AS AN AUTHORED EXPERIENCE</span>
              <h2>
                The art of
                <br />
                <em>chess composition.</em>
              </h2>
              <p>
                Problems, studies and the minds behind them.
                <br />
                Discover how an idea becomes a position.
              </p>
            </span>
            <span className="path-arrow">↗</span>
          </button>
          <button className="path history" onClick={() => filter("history")}>
            <span className="path-number">II.</span>
            <span>
              <span className="eyebrow">CHESS AS A HUMAN PRACTICE</span>
              <h2>
                Chess through
                <br />
                <em>the times.</em>
              </h2>
              <p>
                Players, places and changing worlds.
                <br />
                Follow the game through the lives around it.
              </p>
            </span>
            <span className="path-arrow">↗</span>
          </button>
        </section>
        <section id="lessons" className="lesson-shelf">
          <div className="section-heading">
            <div>
              <p className="eyebrow">THE PLAYABLE COLLECTION</p>
              <h2>
                Try the move. <em>Discover the idea.</em>
              </h2>
            </div>
            <button
              className="text-link"
              onClick={() => {
                setError("");
                setImportOpen(true);
              }}
            >
              Import PGN / FEN ↗
            </button>
          </div>
          <div className="lesson-cards grid grid-cols-1 gap-5 md:grid-cols-2">
            <button
              className="lesson-card story-card"
              onClick={() => {
                setActive(null);
                setEntry(null);
                setImportOpen(false);
                setStoryOpen(true);
              }}
            >
              <span className="lesson-index">↔</span>
              <div>
                <p className="eyebrow">A STORY IN TWO GAMES</p>
                <h3>A queen offered, a mating net.</h3>
                <p>Morphy, 1858 · Réti, 1910</p>
              </div>
              <span>↗</span>
            </button>
            {lessons.map((item, index) => (
              <button
                key={item.content.id}
                className="lesson-card"
                onClick={() => openLesson(item.content.id)}
              >
                <span className="lesson-index">0{index + 1}</span>
                <div>
                  <p className="eyebrow">
                    {item.content.artifact.kind === "composition"
                      ? "COMPOSITION"
                      : "HISTORICAL GAME"}
                  </p>
                  <h3>{item.content.narrative.title}</h3>
                  <p>{item.content.narrative.subtitle}</p>
                </div>
                <span>↗</span>
              </button>
            ))}
          </div>
        </section>
        <section id="collection" className="collection">
          <div className="section-heading">
            <div>
              <p className="eyebrow">THE COLLECTION</p>
              <h2>
                Every position has a <em>context.</em>
              </h2>
            </div>
            <p>
              Follow a person. Step into an era.
              <br />
              Find the connections between them.
            </p>
          </div>
          <div className="controls">
            <div className="tabs" role="group" aria-label="Filter by field">
              {[
                ["all", "All stories"],
                ["composition", "Composition"],
                ["history", "Through the times"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  className={key === field ? "active" : ""}
                  aria-pressed={key === field}
                  onClick={() => setField(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="search">
              <input
                aria-label="Search the collection"
                placeholder="Find a person, place, idea…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </div>
          <div className="filter-row">
            <div className="era-select">
              <label htmlFor="era">ERA</label>
              <select id="era" value={era} onChange={(event) => setEra(event.target.value)}>
                <option value="all">All eras</option>
                <option value="early">Early traditions</option>
                <option value="medieval">Medieval worlds</option>
                <option value="nineteenth">19th century</option>
                <option value="modern">Early 20th century</option>
                <option value="contemporary">Contemporary</option>
              </select>
            </div>
            <span>{entries.length} entries</span>
          </div>
          <div className="entries">
            {entries.map((item) => (
              <button
                className="entry"
                key={item.id}
                onClick={() => {
                  if (["reti", "carpenter"].includes(item.id)) openLesson(item.id);
                  else setEntry(item);
                }}
              >
                <div className="entry-art">
                  <span className="art-year">{item.year}</span>
                  <span className="glyph" aria-hidden="true">
                    {item.mark}
                  </span>
                  <span className="art-type">{item.kind}</span>
                </div>
                <div className="entry-meta">
                  <span className={item.status === "seed" ? "seed-dot" : "research-dot"} />
                  {item.field === "composition"
                    ? "The art of composition"
                    : "Chess through the times"}
                </div>
                <h3>{item.title}</h3>
                <p className="subtitle">{item.subtitle}</p>
                <p className="summary">{item.summary}</p>
                <div className="entry-end">
                  <span>
                    {["reti", "carpenter"].includes(item.id)
                      ? "Open interactive lesson"
                      : "Read the entry"}
                  </span>
                  <span>↗</span>
                </div>
              </button>
            ))}
            {!entries.length && <p className="empty">No entries match these filters.</p>}
          </div>
        </section>
        <section className="approach">
          <p className="eyebrow">THE THREAD THAT CONNECTS IT ALL</p>
          <div className="approach-grid">
            <h2>
              Behind every move,
              <br />
              there is <em>someone.</em>
            </h2>
            <div>
              <p>
                We begin with people and the worlds they inhabit. A study belongs to a composer, a
                magazine and a community of solvers. A game belongs to a place, a moment and two
                lives.
              </p>
              <p>
                Players and composers sit alongside makers, teachers, clubs and everyday
                participants. Eras overlap. Communities cross borders.
              </p>
            </div>
          </div>
        </section>
      </main>
      <footer>
        <a className="footer-brand" href="#">
          ♞ Chess Anthology
        </a>
        <p>Art on the board. Life around it.</p>
        <div className="footer-links">
          <a href="https://github.com/phibkro/chess-anthology">Source & credits ↗</a>
        </div>
      </footer>
      <dialog
        ref={reader}
        className={active || storyOpen ? "lesson-dialog" : ""}
        onCancel={close}
        onClose={close}
      >
        <div className="reader-bar">
          <span>CHESS ANTHOLOGY / READING ROOM</span>
          <button aria-label="Close reading room" onClick={close}>
            Close ×
          </button>
        </div>
        {storyOpen && <StoryReader />}
        {active && <Reader key={active.content.id} lesson={active} />}
        {entry && (
          <article className="entry-reader">
            <h2>{entry.title}</h2>
            <p className="reader-subtitle">{entry.subtitle}</p>
            {entry.body.map((text) => (
              <p key={text}>{text}</p>
            ))}
            {entry.source && (
              <a className="text-link" href={entry.source} target="_blank" rel="noreferrer">
                {entry.sourceLabel} ↗
              </a>
            )}
          </article>
        )}
        {importOpen && (
          <section className="import-panel">
            <h2>Bring a position or a game.</h2>
            <p>
              Import stays in your browser. PGN keeps the score, comments and variations; lesson
              prompts are authored separately.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                try {
                  const imported =
                    format === "pgn"
                      ? importPgn(importText)
                      : format === "json"
                        ? compileLesson(JSON.parse(importText))
                        : importFen(importText);
                  setImportOpen(false);
                  setActive(imported);
                  setError("");
                } catch (caught) {
                  setError(
                    caught instanceof Error ? caught.message : "Could not import this content.",
                  );
                }
              }}
            >
              <label htmlFor="import-format">Format</label>
              <select
                id="import-format"
                value={format}
                onChange={(event) => setFormat(event.target.value)}
              >
                <option value="pgn">PGN</option>
                <option value="fen">FEN</option>
                <option value="json">Lesson JSON</option>
              </select>
              <label htmlFor="import-content">Content</label>
              <textarea
                id="import-content"
                rows={10}
                value={importText}
                onChange={(event) => setImportText(event.target.value)}
              />
              <p className="import-error" role="alert">
                {error}
              </p>
              <button className="primary" type="submit" disabled={!importText.trim()}>
                Open locally ↗
              </button>
            </form>
          </section>
        )}
      </dialog>
    </>
  );
}

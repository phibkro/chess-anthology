/* oxlint-disable no-await-in-loop -- Revisions must be applied in order to demonstrate incremental reuse. */
import {
  compile,
  createCompiler,
  envelope,
  restore,
  printStructured,
  decode,
  selectPosition,
} from "../compiler/index.js";
import { readSourceText } from "../runtime/source-text.js";

const required = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Required fixture value is unavailable.");
  }
  return value;
};

const dir = new URL("../../examples/", import.meta.url);
const sources = new Map(
  await Promise.all(
    [
      ...new Bun.Glob("*").scanSync({
        cwd: Bun.fileURLToPath(dir),
        dot: true,
        onlyFiles: true,
      }),
    ].map(async (name) => {
      const uri = new URL(name, dir);
      return [uri.href, await readSourceText(uri)] as const;
    })
  )
);
const storyUri = new URL("story.chess-story", dir).href;
const original = required(sources.get(storyUri));
const compiler = createCompiler();
const first = await compiler.update(sources);
if (!first.ok) {
  console.error(first.error);
  process.exit(1);
}
const { snapshot, work } = first.value;
console.log("PROTOTYPE — explicit phases and immutable build snapshots", work);
console.log(JSON.stringify(snapshot, null, 2));
const authored = required(
  required(snapshot.output.find((d) => d.uri === storyUri)).data
);
const restored = restore(
  // oxlint-disable-next-line unicorn/prefer-structured-clone -- This tests a JSON transport roundtrip, not an in-memory clone.
  JSON.parse(JSON.stringify(envelope(authored, original)))
);
console.log(
  "Exact untouched source round-trip:",
  restored.ok && restored.value === original
);
const printed = printStructured(authored);
if (printed.ok) {
  const parsed = decode(printed.value);
  console.log(
    "Structured → flat → structured:",
    parsed.ok && Bun.deepEquals(parsed.value, authored, true)
  );
}
for (const ending of ["\n", "\r\n"]) {
  const text = original.replaceAll("\n", ending);
  const restoredText = restore(envelope(authored, text));
  console.log(
    "Source trivia preserved",
    JSON.stringify(ending),
    restoredText.ok && restoredText.value === text
  );
}
const noChange = await compiler.update(sources);
console.log("No-op build:", noChange.ok ? noChange.value.work : noChange.error);
const prose = new Map(sources);
prose.set(storyUri, original.replace("The queen opens", "This queen opens"));
const edited = await compiler.update(prose);
console.log("Prose-only build:", edited.ok ? edited.value.work : edited.error);
console.log(
  "Read position (no command/event):",
  selectPosition(snapshot, new URL("opera.pgn", dir).href, 30)
);
for (const [label, source] of [
  [
    "missing module",
    original.replace("./library.chess-story", "./missing.chess-story"),
  ],
  ["unavailable game", original.replace("game opera", "game absent")],
  ["missing position", original.replace("after 30", "after 300")],
  ["illegal answer", original.replace("Qb8+", "Qh9")],
  ["parse error", original.replace('answer "Qb8+"', "answer")],
  ["lexical error", `${original}\n @`],
]) {
  const changed = new Map(sources);
  changed.set(storyUri, source);
  const result = await compile(changed);
  console.log(
    label,
    result.ok
      ? result.value.output.find((d) => d.uri === storyUri)?.diagnostics
      : result.error
  );
}
const stale = envelope(structuredClone(authored), original);
stale.data = { ...stale.data, name: "changed" };
const refused = restore(stale);
console.log(
  "Stale source is an error value:",
  !refused.ok && refused.error.code
);

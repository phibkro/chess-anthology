import { readdir, readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import {
  compile,
  createCompiler,
  envelope,
  restore,
  printStructured,
  decode,
  selectPosition,
} from "../compiler/index.js";
const dir = new URL("../../examples/", import.meta.url);
const sources = new Map(
  await Promise.all(
    (await readdir(dir)).map(async (name) => {
      const uri = new URL(name, dir);
      return [uri.href, await readFile(uri, "utf8")] as const;
    }),
  ),
);
const storyUri = new URL("story.chess-story", dir).href;
const original = sources.get(storyUri)!;
const compiler = createCompiler();
const first = await compiler.update(sources);
if (!first.ok) {
  console.error(first.error);
  process.exit(1);
}
const { snapshot, work } = first.value;
console.log("PROTOTYPE — explicit phases and immutable build snapshots", work);
console.log(JSON.stringify(snapshot, null, 2));
const authored = snapshot.output.find((d) => d.uri === storyUri)!.data!;
const restored = restore(JSON.parse(JSON.stringify(envelope(authored, original))));
console.log("Exact untouched source round-trip:", restored.ok && restored.value === original);
const printed = printStructured(authored);
if (printed.ok) {
  const parsed = decode(printed.value);
  console.log(
    "Structured → flat → structured:",
    parsed.ok && isDeepStrictEqual(parsed.value, authored),
  );
}
for (const ending of ["\n", "\r\n"]) {
  const text = original.replaceAll("\n", ending);
  const restored = restore(envelope(authored, text));
  console.log(
    "Source trivia preserved",
    JSON.stringify(ending),
    restored.ok && restored.value === text,
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
  selectPosition(snapshot, new URL("opera.pgn", dir).href, 30),
);
for (const [label, source] of [
  ["missing module", original.replace("./library.chess-story", "./missing.chess-story")],
  ["unavailable game", original.replace("game opera", "game absent")],
  ["missing position", original.replace("after 30", "after 300")],
  ["illegal answer", original.replace("Qb8+", "Qh9")],
  ["parse error", original.replace('answer "Qb8+"', "answer")],
  ["lexical error", original + "\n @"],
]) {
  const changed = new Map(sources);
  changed.set(storyUri, source);
  const result = await compile(changed);
  console.log(
    label,
    result.ok ? result.value.output.find((d) => d.uri === storyUri)?.diagnostics : result.error,
  );
}
const stale = envelope(structuredClone(authored), original);
stale.data = { ...stale.data, name: "changed" };
const refused = restore(stale);
console.log("Stale source is an error value:", !refused.ok && refused.error.code);

import { readdir, readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { compile, envelope, restore, printStructured } from "./compiler.js";
import { lower } from "./services.js";
import { isModule } from "./generated/ast.js";
import { analyzeScene, replay } from "./chess.js";
const dir = new URL("../examples/", import.meta.url);
const sources = new Map(
  await Promise.all(
    (await readdir(dir)).map(async (name) => {
      const uri = new URL(name, dir);
      return [uri.href, await readFile(uri, "utf8")] as const;
    }),
  ),
);
const storyUri = new URL("story.chess-story", dir).href;
const libraryUri = new URL("library.chess-story", dir).href;
const original = sources.get(storyUri)!;
const result = await compile(sources);
console.log("PROTOTYPE — two-game linked narrative");
console.log(JSON.stringify(result.output, null, 2));
const authored = result.output.find((d) => d.uri === storyUri)!.data!;
const restored = restore(JSON.parse(JSON.stringify(envelope(authored, original))), result);
console.log("Exact untouched JSON envelope round-trip:", restored === original);
const normalized = printStructured(authored);
const parsed = result.language.parser.LangiumParser.parse(normalized);
console.log(
  "Canonical printing syntax errors:",
  parsed.lexerErrors.length + parsed.parserErrors.length,
);
console.log(
  "Structured → flat → structured:",
  isModule(parsed.value) && isDeepStrictEqual(lower(parsed.value), authored),
);
for (const ending of ["\n", "\r\n"]) {
  const text = original.replaceAll("\n", ending);
  console.log(
    "Source trivia preserved",
    JSON.stringify(ending),
    restore(envelope(authored, text), result) === text,
  );
}
const position = original.indexOf("Qb8+") + 2;
const document = result.documents.find((d) => d.uri.toString() === storyUri)!;
const completion = await result.language.lsp.CompletionProvider?.getCompletion(document, {
  textDocument: { uri: storyUri },
  position: document.textDocument.positionAt(position),
});
console.log(
  "LSP legal-move completion includes Qb8+:",
  completion?.items.some((i) => i.label === "Qb8+"),
);
const cases = [
  ["missing module", original.replace("./library.chess-story", "./missing.chess-story")],
  ["unavailable game", original.replace("game opera", "game absent")],
  ["private game", original.replace("game opera", "game privateGame")],
  ["missing position", original.replace("after 30", "after 300")],
  ["illegal answer", original.replace("Qb8+", "Qh9")],
  ["invalid arrow", original.replace('"b3"', '"z9"')],
  ["parse error", original.replace('answer "Qb8+"', "answer")],
  ["lexical error", original + "\n @"],
] as const;
for (const [label, source] of cases) {
  const changed = new Map(sources);
  changed.set(storyUri, source);
  const run = await compile(changed);
  console.log(label, JSON.stringify(run.output.find((d) => d.uri === storyUri)?.diagnostics));
}
const data = structuredClone(authored);
data.stories[0].scenes[0].notes.push({ type: "prompt", text: "Try", answer: "Qh9" });
const pgn = sources.get(new URL("opera.pgn", dir).href)!;
console.log(
  "Structured input uses the same semantic analyzer:",
  analyzeScene(data.stories[0].scenes[0], replay(pgn).frames),
);
const changedDependency = new Map(sources);
changedDependency.set(
  libraryUri,
  sources.get(libraryUri)!.replace("export game opera", "game opera"),
);
const rebuilt = await compile(changedDependency);
console.log(
  "Changed export invalidates dependent:",
  rebuilt.output.find((d) => d.uri === storyUri)?.diagnostics,
);
const stale = envelope(authored, original);
stale.data = structuredClone(authored);
stale.data.name = "changed";
try {
  restore(stale, result);
  console.log("ERROR: stale source accepted");
} catch {
  console.log("Stale source envelope rejected: true");
}
console.log("Example directory:", fileURLToPath(dir));

// PROTOTYPE: conservative whole-workspace rebuilds; no hidden stale dependency cache.
import { URI, AstUtils } from "langium";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { isModule, isStory } from "./generated/ast.js";
import { createServices, lower, relative, type Sources } from "./services.js";
import { positionData, replay } from "./chess.js";
import { parseStructured, type DocumentData } from "./model.js";

export async function compile(sources: Sources) {
  const { shared, language } = createServices(sources);
  const documents = [...sources]
    .filter(([uri]) => uri.endsWith(".chess-story"))
    .map(([uri, text]) => shared.workspace.LangiumDocuments.createDocument(URI.parse(uri), text));
  await shared.workspace.DocumentBuilder.build(documents, { validation: true });
  const output = documents.map((document) => {
    const root = document.parseResult.value;
    const diagnostics = (document.diagnostics ?? []).map((d) => ({
      code: d.code === "linking-error" ? "link/unresolved-game" : d.code,
      message: d.message,
      severity: d.severity,
      range: d.range,
      stage: String(d.code).startsWith("link/")
        ? "linking"
        : String(d.code).startsWith("source/")
          ? "acquisition"
          : d.code === "lexing-error"
            ? "lexical"
            : d.code === "parsing-error"
              ? "syntax"
              : String(d.code).startsWith("chess/")
                ? "chess"
                : "semantic",
    }));
    const validSyntax =
      document.parseResult.lexerErrors.length === 0 &&
      document.parseResult.parserErrors.length === 0;
    const data = validSyntax && isModule(root) ? lower(root) : undefined;
    const occurrences =
      isModule(root) && validSyntax
        ? root.declarations.filter(isStory).flatMap((story) =>
            story.scenes.flatMap((scene) => {
              const game = scene.game.ref;
              if (!game) return [];
              const gameUri = relative(AstUtils.getDocument(game).uri.toString(), game.path);
              const pgn = sources.get(gameUri);
              if (pgn === undefined) return [];
              const position = replay(pgn).frames[scene.ply];
              if (!position) return [];
              return [
                {
                  id: `${document.uri.toString()}#${story.name}/${scene.name}`,
                  game: `${AstUtils.getDocument(game).uri.toString()}#${game.name}`,
                  ply: scene.ply,
                  ...positionData(position),
                  sourceDigest: digest(pgn),
                },
              ];
            }),
          )
        : [];
    return {
      uri: document.uri.toString(),
      data,
      sourceText: document.textDocument.getText(),
      diagnostics,
      occurrences,
    };
  });
  return { output, shared, language, documents };
}
export function digest(text: string) {
  return createHash("sha256").update(text).digest("hex");
}
export function envelope(data: DocumentData, sourceText: string) {
  return {
    format: "chess-source-envelope-prototype",
    version: 0,
    data,
    sourceText,
    digest: digest(sourceText),
  };
}
export function restore(
  envelope: ReturnType<typeof import("./compiler.js").envelope>,
  services: Awaited<ReturnType<typeof compile>>,
) {
  if (
    envelope.format !== "chess-source-envelope-prototype" ||
    envelope.version !== 0 ||
    digest(envelope.sourceText) !== envelope.digest
  )
    throw new Error("Unsupported or modified source envelope.");
  const data = parseStructured(envelope.data);
  const parsed = services.language.parser.LangiumParser.parse(envelope.sourceText);
  if (
    parsed.lexerErrors.length ||
    parsed.parserErrors.length ||
    !isModule(parsed.value) ||
    !isDeepStrictEqual(lower(parsed.value), data)
  )
    throw new Error("Source and structured data disagree; refusing stale source.");
  return envelope.sourceText;
}
export function printStructured(input: unknown): string {
  const data = parseStructured(input);
  const q = JSON.stringify;
  return [
    `module ${data.name};`,
    ...data.imports.map((path) => `import ${q(path)};`),
    ...data.games.map((g) => `${g.exported ? "export " : ""}game ${g.name} from ${q(g.source)};`),
    ...data.stories.map(
      (s) =>
        `story ${s.name} {\n${s.scenes
          .map(
            (scene) =>
              `  board ${scene.name} game ${scene.game} after ${scene.ply} {\n${scene.notes
                .map(
                  (n) =>
                    `    ${n.type === "text" ? `text ${q(n.text)}` : n.type === "arrow" ? `arrow ${q(n.from)} -> ${q(n.to)} ${n.color}` : `prompt ${q(n.text)} answer ${q(n.answer)}`};`,
                )
                .join("\n")}\n  }`,
          )
          .join("\n")}\n}`,
    ),
    "",
  ].join("\n");
}

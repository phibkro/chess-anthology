import { AstUtils, type LangiumDocument } from "langium";
import { isModule, isStory } from "../100-parsing/index.js";
import { lower } from "../200-semantic-analysis/index.js";
import { relative, type Sources } from "../300-linking/index.js";
import { createChessAnalysis, positionData } from "../400-chess-analysis/index.js";
import { digest, freeze } from "../identity.js";
export { decode, envelope, restore, printStructured } from "./codec.js";
export function emitDocument(
  document: LangiumDocument,
  sources: Sources,
  analysis: ReturnType<typeof createChessAnalysis>,
) {
  const root = document.parseResult.value;
  const diagnostics = (document.diagnostics ?? []).map((d) => ({
    code: d.code === "linking-error" ? "link/unresolved-game" : d.code,
    message: d.message,
    severity: d.severity,
    range: d.range,
    phase:
      String(d.code).startsWith("chess/") || String(d.code).startsWith("annotation/")
        ? "400-chess-analysis"
        : String(d.code).startsWith("link/") || String(d.code).startsWith("source/")
          ? "300-linking"
          : d.code === "lexing-error" || d.code === "parsing-error"
            ? "100-parsing"
            : "200-semantic-analysis",
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
    document.parseResult.lexerErrors.length === 0 && document.parseResult.parserErrors.length === 0;
  const lowered = validSyntax && isModule(root) ? lower(root) : undefined;
  const data = lowered?.ok ? lowered.value : undefined;
  const occurrences =
    isModule(root) && validSyntax
      ? root.declarations.filter(isStory).flatMap((story) =>
          story.scenes.flatMap((scene) => {
            const game = scene.game.ref;
            if (!game) return [];
            const gameUri = relative(AstUtils.getDocument(game).uri.toString(), game.path);
            const pgn = sources.get(gameUri);
            if (pgn === undefined) return [];
            const replayed = analysis.replay(pgn);
            const position = replayed.ok ? replayed.value.frames[scene.ply] : undefined;
            if (!position) return [];
            return [
              {
                id: `${document.uri.toString()}#${story.name}/${scene.name}`,
                game: `${AstUtils.getDocument(game).uri.toString()}#${game.name}`,
                ply: scene.ply,
                ...positionData(position),
                sourceDigest: digest(pgn),
                sourceUri: gameUri,
              },
            ];
          }),
        )
      : [];
  return freeze({
    uri: document.uri.toString(),
    data,
    sourceText: document.textDocument.getText(),
    diagnostics,
    occurrences,
  });
}
export type EmittedDocument = ReturnType<typeof emitDocument>;
export { createPlaybackPlan } from "./playback.js";

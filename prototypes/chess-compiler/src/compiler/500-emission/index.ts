import { AstUtils } from "langium";
import type { LangiumDocument } from "langium";

import type {
  EmittedDocument,
  CompilationDiagnostic,
} from "../../contracts/index.js";
import { isModule, isStory } from "../100-parsing/index.js";
import { lower } from "../200-semantic-analysis/index.js";
import { relative } from "../300-linking/index.js";
import type { Sources } from "../300-linking/index.js";
import type { createChessAnalysis } from "../400-chess-analysis/index.js";
import { positionData } from "../400-chess-analysis/index.js";
import { digest, freeze } from "../identity.js";

export { decode, envelope, restore, printStructured } from "./codec.js";
/**
 * Project a validated workspace document into plain data and diagnostics.
 * @param document - The workspace document being emitted.
 * @param sources - Configured source text indexed by canonical URI.
 * @param analysis - Shared chess replay analysis for this workspace.
 * @returns Project a validated workspace document into plain data and diagnostics.
 */
export const emitDocument = (
  document: LangiumDocument,
  sources: Sources,
  analysis: ReturnType<typeof createChessAnalysis>
): EmittedDocument => {
  const root = document.parseResult.value;
  const diagnostics: CompilationDiagnostic[] = (document.diagnostics ?? []).map(
    (item) => {
      const code =
        item.code === "linking-error" ? "link/unresolved-game" : item.code;
      let phase: CompilationDiagnostic["phase"] = "200-semantic-analysis";
      let stage: CompilationDiagnostic["stage"] = "semantic";
      const text = String(code);
      if (text.startsWith("chess/") || text.startsWith("annotation/")) {
        phase = "400-chess-analysis";
        stage = "chess";
      } else if (text.startsWith("link/")) {
        phase = "300-linking";
        stage = "linking";
      } else if (text.startsWith("source/")) {
        phase = "300-linking";
        stage = "acquisition";
      } else if (code === "lexing-error") {
        phase = "100-parsing";
        stage = "lexical";
      } else if (code === "parsing-error") {
        phase = "100-parsing";
        stage = "syntax";
      }
      return {
        code,
        message: item.message,
        phase,
        range: item.range,
        severity: item.severity,
        stage,
      };
    }
  );
  const validSyntax =
    document.parseResult.lexerErrors.length === 0 &&
    document.parseResult.parserErrors.length === 0;
  const lowered = validSyntax && isModule(root) ? lower(root) : undefined;
  const data = lowered?.ok === true ? lowered.value : undefined;
  const occurrences =
    isModule(root) && validSyntax
      ? root.declarations.filter(isStory).flatMap((story) =>
          story.scenes.flatMap((scene) => {
            const game = scene.game.ref;
            if (!game) {
              return [];
            }
            const gameUri = relative(
              AstUtils.getDocument(game).uri.toString(),
              game.path
            );
            const pgn = sources.get(gameUri);
            if (pgn === undefined) {
              return [];
            }
            const replayed = analysis.replay(pgn);
            const position = replayed.ok
              ? replayed.value.frames[scene.ply]
              : undefined;
            if (!position) {
              return [];
            }
            return [
              {
                game: `${AstUtils.getDocument(game).uri.toString()}#${game.name}`,
                id: `${document.uri.toString()}#${story.name}/${scene.name}`,
                ply: scene.ply,
                ...positionData(position),
                sourceDigest: digest(pgn),
                sourceUri: gameUri,
              },
            ];
          })
        )
      : [];
  return freeze({
    data,
    diagnostics,
    occurrences,
    sourceText: document.textDocument.getText(),
    uri: document.uri.toString(),
  });
};
export type { EmittedDocument } from "../../contracts/index.js";
export { createPlaybackPlan } from "./playback.js";

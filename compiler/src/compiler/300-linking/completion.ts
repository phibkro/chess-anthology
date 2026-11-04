import { AstUtils, URI } from "langium";
import type { LangiumDocument } from "langium";
import { DefaultCompletionProvider } from "langium/lsp";
import type { LangiumServices } from "langium/lsp";
import type { CompletionParams } from "vscode-languageserver";

import { markdownCompletion } from "../../authoring/completion.js";
import type { Sources } from "../../contracts/index.js";
import { isModule, isGame, isScene } from "../100-parsing/index.js";
import type { createChessAnalysis } from "../400-chess-analysis/index.js";
import { relative } from "./source-uri.js";
/** Provide chess-aware answer completion over the shared replay cache. */
export class ChessCompletion extends DefaultCompletionProvider {
  private readonly documents: LangiumServices["shared"]["workspace"]["LangiumDocuments"];
  private readonly sources: Sources;
  private readonly analysis: ReturnType<typeof createChessAnalysis>;
  /**
   * Configure completion for linked chess positions.
   * @param services - Language services.
   * @param sources - Configured source text.
   * @param analysis - Shared replay analysis.
   */
  constructor(
    services: LangiumServices,
    sources: Sources,
    analysis: ReturnType<typeof createChessAnalysis>
  ) {
    super(services);
    this.documents = services.shared.workspace.LangiumDocuments;
    this.sources = sources;
    this.analysis = analysis;
  }
  private importedGames(document: LangiumDocument, paths: string[]) {
    return paths.flatMap((path) => {
      const uri = relative(document.uri.toString(), path);
      const root = this.documents.getDocument(URI.parse(uri))?.parseResult
        .value;
      return root && isModule(root)
        ? root.declarations
            .filter(isGame)
            .filter((game) => game.exported)
            .map((game) => ({
              name: game.name,
              source: relative(uri, game.path),
            }))
        : [];
    });
  }
  private markdown(document: LangiumDocument, params: CompletionParams) {
    const completion = markdownCompletion(document, params);
    if (completion.kind === "items") {
      return { isIncomplete: false, items: completion.items };
    }
    if (completion.kind === "games") {
      const names = new Set([
        ...completion.names,
        ...this.importedGames(document, completion.imports).map(
          (game) => game.name
        ),
      ]);
      return {
        isIncomplete: false,
        items: [...names].map((name) => ({
          label: name,
          textEdit: { newText: name, range: completion.range },
        })),
      };
    }
    const local = completion.data.games.find(
      (game) => game.name === completion.game
    );
    const uri = local
      ? relative(document.uri.toString(), local.source)
      : this.importedGames(document, completion.data.imports).find(
          (game) => game.name === completion.game
        )?.source;
    const source = uri === undefined ? undefined : this.sources.get(uri);
    const history =
      source === undefined ? undefined : this.analysis.replay(source);
    const position =
      history?.ok === true ? history.value.frames[completion.ply] : undefined;
    return {
      isIncomplete: false,
      items: position
        ? this.analysis.project(position).legalMoves.map((move) => ({
            detail: move.uci,
            label: move.san,
            textEdit: { newText: move.san, range: completion.range },
          }))
        : [],
    };
  }
  /**
   * Suggest legal SAN answers at the selected board occurrence.
   * @param document - The editor document.
   * @param params - Cursor and completion context.
   * @returns Legal moves or the default language completions.
   */
  override async getCompletion(
    document: LangiumDocument,
    params: CompletionParams
  ) {
    if (document.uri.path.endsWith(".chess.md")) {
      return this.markdown(document, params);
    }
    const offset = document.textDocument.offsetAt(params.position);
    const prefix = document.textDocument.getText().slice(0, offset);
    const match = /answer\s+"(?<capture1>[^"\n]*)$/u.exec(prefix);
    if (match) {
      const scene = AstUtils.streamAllContents(document.parseResult.value)
        .filter(isScene)
        .find(
          (s) =>
            !!s.$cstNode &&
            s.$cstNode.offset <= offset &&
            s.$cstNode.end >= offset
        );
      const game = scene?.game.ref;
      if (scene && game) {
        const source = this.sources.get(
          relative(AstUtils.getDocument(game).uri.toString(), game.path)
        );
        const history =
          source === undefined ? undefined : this.analysis.replay(source);
        const position =
          history?.ok === true ? history.value.frames[scene.ply] : undefined;
        if (position) {
          const start = document.textDocument.positionAt(
            offset - match[1].length
          );
          const endQuote = document.textDocument.getText().indexOf('"', offset);
          const end =
            endQuote === -1
              ? params.position
              : document.textDocument.positionAt(endQuote);
          return {
            isIncomplete: false,
            items: this.analysis.project(position).legalMoves.map((move) => ({
              detail: move.uci,
              label: move.san,
              textEdit: { newText: move.san, range: { end, start } },
            })),
          };
        }
      }
    }
    return await super.getCompletion(document, params);
  }
}

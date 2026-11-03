import { EmptyFileSystem, inject, AstUtils, URI } from "langium";
import type { AstNode, ValidationChecks } from "langium";
import { createDefaultModule, createDefaultSharedModule } from "langium/lsp";
import type { DefaultSharedModuleContext, LangiumServices } from "langium/lsp";

import type { Sources } from "../../contracts/index.js";
import {
  ChessNarrativeGeneratedModule,
  ChessNarrativeGeneratedSharedModule,
  jsonParserModule,
  isModule,
  isGame,
  isStory,
} from "../100-parsing/index.js";
import type { Module, ChessNarrativeAstType } from "../100-parsing/index.js";
import {
  lowerScene,
  lower,
  analyzeLocal,
} from "../200-semantic-analysis/index.js";
import {
  analyzeScene,
  createChessAnalysis,
} from "../400-chess-analysis/index.js";
import { ChessCompletion } from "./completion.js";
import { ImportScope } from "./scope.js";
import { relative } from "./source-uri.js";
import { ChessValidator } from "./validator.js";

export { relative } from "./source-uri.js";
export type { Sources } from "../../contracts/index.js";

/**
 * Configure Langium parsing, linking, validation and completion services.
 * @param sources - Configured source text indexed by canonical URI.
 * @param context - Framework filesystem and language-server connection services.
 * @param analysis - Shared chess replay analysis for this workspace.
 * @returns Configure Langium parsing, linking, validation and completion services.
 */
export const createServices = (
  sources: Sources,
  context: DefaultSharedModuleContext = EmptyFileSystem,
  analysis = createChessAnalysis()
) => {
  const shared = inject(
    createDefaultSharedModule(context),
    ChessNarrativeGeneratedSharedModule
  );
  const language = inject(
    createDefaultModule({ shared }),
    ChessNarrativeGeneratedModule,
    jsonParserModule,
    {
      lsp: {
        CompletionProvider: (s: LangiumServices) =>
          new ChessCompletion(s, sources, analysis),
      },
      references: { ScopeProvider: (s: LangiumServices) => new ImportScope(s) },
      validation: {
        DocumentValidator: (s: LangiumServices) => new ChessValidator(s),
      },
    }
  );
  shared.ServiceRegistry.register(language);
  // Export only explicitly exported games into Langium's global index.
  const descriptions = language.workspace.AstNodeDescriptionProvider;
  // oxlint-disable-next-line require-await -- Langium requires a Promise lifecycle callback; symbol descriptions are already in memory.
  language.references.ScopeComputation.collectExportedSymbols = async (
    document
  ) => {
    const root = document.parseResult.value;
    if (!isModule(root)) {
      return [];
    }
    return root.declarations
      .filter(isGame)
      .filter((g) => g.exported)
      .map((g) => descriptions.createDescription(g, g.name, document));
  };
  const checks: ValidationChecks<ChessNarrativeAstType> = {
    Game(game, accept) {
      const uri = relative(
        AstUtils.getDocument(game).uri.toString(),
        game.path
      );
      const source = sources.get(uri);
      if (source === undefined) {
        accept("error", `Unavailable PGN ${game.path}.`, {
          code: "source/missing-game",
          node: game,
          property: "path",
        });
      } else {
        const result = analysis.replay(source);
        if (!result.ok) {
          accept("error", result.error.message, {
            code: "chess/invalid-game",
            node: game,
            property: "path",
          });
        }
      }
    },
    Module(module: Module, accept) {
      const uri = AstUtils.getDocument(module).uri.toString();
      const lowered = lower(module);
      if (!lowered.ok) {
        accept("error", lowered.error.message, {
          code: lowered.error.code,
          node: module,
          property: "name",
        });
      }
      if (lowered.ok) {
        for (const issue of analyzeLocal(lowered.value)) {
          const declaration =
            issue.path[0] === "games"
              ? module.declarations.filter(isGame)[Number(issue.path[1])]
              : module.declarations.filter(isStory)[Number(issue.path[1])];
          const node =
            issue.path[2] === "scenes" &&
            declaration !== undefined &&
            isStory(declaration)
              ? declaration.scenes[Number(issue.path[3])]
              : declaration;
          accept("error", issue.message, {
            code: issue.code,
            node: node ?? module,
            property: "name",
          });
        }
      }
      const visibleNames = new Set<string>();
      for (const imp of module.imports) {
        const imported = shared.workspace.LangiumDocuments.getDocument(
          URI.parse(relative(uri, imp.path))
        )?.parseResult.value;
        if (imported && isModule(imported)) {
          for (const game of imported.declarations
            .filter(isGame)
            .filter((g) => g.exported)) {
            if (visibleNames.has(game.name)) {
              accept("error", `Ambiguous imported game ${game.name}.`, {
                code: "link/ambiguous-game",
                node: imp,
                property: "path",
              });
            }
            visibleNames.add(game.name);
          }
        }
      }
      const cycle = (
        current: Module,
        location: string,
        stack: string[]
      ): string[] | undefined => {
        if (stack.includes(location)) {
          return [...stack, location];
        }
        for (const imp of current.imports) {
          const next = relative(location, imp.path);
          const root = shared.workspace.LangiumDocuments.getDocument(
            URI.parse(next)
          )?.parseResult.value;
          if (root && isModule(root)) {
            const found = cycle(root, next, [...stack, location]);
            if (found) {
              return found;
            }
          }
        }
        return undefined;
      };
      const loop = cycle(module, uri, []);
      if (loop) {
        accept("error", `Import cycle: ${loop.join(" -> ")}`, {
          code: "link/import-cycle",
          node: module,
          property: "name",
        });
      }
      for (const imp of module.imports) {
        const target = relative(uri, imp.path);
        if (!shared.workspace.LangiumDocuments.hasDocument(URI.parse(target))) {
          accept("error", `Unavailable module ${imp.path}.`, {
            code: "link/missing-module",
            node: imp,
            property: "path",
          });
        }
      }
    },
    Scene(scene, accept) {
      const game = scene.game.ref;
      if (!game) {
        return;
      }
      // Langium reports the unresolved cross-reference.
      const source = sources.get(
        relative(AstUtils.getDocument(game).uri.toString(), game.path)
      );
      if (source === undefined) {
        return;
      }
      const result = analysis.replay(source);
      if (!result.ok) {
        return;
      }
      for (const issue of analyzeScene(
        lowerScene(scene),
        result.value.frames
      )) {
        const [, noteIndex] = issue.path;
        const node: AstNode = Number.isInteger(noteIndex)
          ? scene.notes[Number(noteIndex)]
          : scene;
        accept("error", issue.message, {
          code: issue.code,
          node,
          property: String(issue.path.at(-1)),
        });
      }
    },
  };
  language.validation.ValidationRegistry.register(checks);
  return { analysis, language, shared };
};

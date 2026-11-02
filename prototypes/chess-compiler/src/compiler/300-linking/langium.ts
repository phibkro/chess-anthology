import {
  DefaultScopeProvider,
  DefaultDocumentValidator,
  type ValidationOptions,
  EmptyFileSystem,
  inject,
  AstUtils,
  URI,
  type ReferenceInfo,
  type LangiumDocument,
  type AstNode,
  type ValidationChecks,
} from "langium";
import {
  createDefaultModule,
  createDefaultSharedModule,
  DefaultCompletionProvider,
  type DefaultSharedModuleContext,
  type LangiumServices,
} from "langium/lsp";
import type { CompletionParams, CancellationToken } from "vscode-languageserver";
import {
  ChessNarrativeGeneratedModule,
  ChessNarrativeGeneratedSharedModule,
} from "../100-parsing/index.js";
import {
  jsonParserModule,
  isModule,
  isGame,
  isScene,
  type Module,
  type ChessNarrativeAstType,
} from "../100-parsing/index.js";
import { analyzeScene, createChessAnalysis, positionData } from "../400-chess-analysis/index.js";
import { lowerScene, lower, analyzeLocal } from "../200-semantic-analysis/index.js";

export type Sources = Map<string, string>;
export function relative(base: string, path: string) {
  // Invalid references remain unavailable values, rather than throwing during validation.
  try {
    return new URL(path, base).href;
  } catch {
    return `unresolved:${encodeURIComponent(path)}`;
  }
}

class ImportScope extends DefaultScopeProvider {
  override getScope(context: ReferenceInfo) {
    if (!isScene(context.container)) return super.getScope(context);
    const document = AstUtils.getDocument(context.container);
    const root = document.parseResult.value;
    if (!isModule(root)) return super.getScope(context);
    const imported = new Set(root.imports.map((i) => relative(document.uri.toString(), i.path)));
    // Explicit import visibility; an unrelated workspace module cannot satisfy a reference.
    const exported = this.indexManager
      .allElements("Game")
      .filter((d) => imported.has(d.documentUri.toString()));
    return this.createScopeForNodes(root.declarations.filter(isGame), this.createScope(exported));
  }
}

export function createServices(
  sources: Sources,
  context: DefaultSharedModuleContext = EmptyFileSystem,
  analysis = createChessAnalysis(),
) {
  const shared = inject(createDefaultSharedModule(context), ChessNarrativeGeneratedSharedModule);
  const language = inject(
    createDefaultModule({ shared }),
    ChessNarrativeGeneratedModule,
    jsonParserModule,
    {
      validation: { DocumentValidator: (s: LangiumServices) => new ChessValidator(s) },
      references: { ScopeProvider: (s: LangiumServices) => new ImportScope(s) },
      lsp: {
        CompletionProvider: (s: LangiumServices) => new ChessCompletion(s, sources, analysis),
      },
    },
  );
  shared.ServiceRegistry.register(language);
  // Export only explicitly exported games into Langium's global index.
  const descriptions = language.workspace.AstNodeDescriptionProvider;
  language.references.ScopeComputation.collectExportedSymbols = async (document) => {
    const root = document.parseResult.value;
    if (!isModule(root)) return [];
    return root.declarations
      .filter(isGame)
      .filter((g) => g.exported)
      .map((g) => descriptions.createDescription(g, g.name, document));
  };
  const checks: ValidationChecks<ChessNarrativeAstType> = {
    Module(module: Module, accept) {
      const uri = AstUtils.getDocument(module).uri.toString();
      const lowered = lower(module);
      if (!lowered.ok)
        accept("error", lowered.error.message, {
          node: module,
          property: "name",
          code: lowered.error.code,
        });
      if (lowered.ok)
        for (const issue of analyzeLocal(lowered.value)) {
          const declaration =
            issue.path[0] === "games"
              ? module.declarations.filter(isGame)[Number(issue.path[1])]
              : module;
          accept("error", issue.message, { node: declaration, property: "name", code: issue.code });
        }
      const visibleNames = new Set<string>();
      for (const imp of module.imports) {
        const imported = shared.workspace.LangiumDocuments.getDocument(
          URI.parse(relative(uri, imp.path)),
        )?.parseResult.value;
        if (imported && isModule(imported))
          for (const game of imported.declarations.filter(isGame).filter((g) => g.exported)) {
            if (visibleNames.has(game.name))
              accept("error", `Ambiguous imported game ${game.name}.`, {
                node: imp,
                property: "path",
                code: "link/ambiguous-game",
              });
            visibleNames.add(game.name);
          }
      }
      function cycle(current: Module, location: string, stack: string[]): string[] | undefined {
        if (stack.includes(location)) return [...stack, location];
        for (const imp of current.imports) {
          const next = relative(location, imp.path);
          const root = shared.workspace.LangiumDocuments.getDocument(URI.parse(next))?.parseResult
            .value;
          if (root && isModule(root)) {
            const found = cycle(root, next, [...stack, location]);
            if (found) return found;
          }
        }
      }
      const loop = cycle(module, uri, []);
      if (loop)
        accept("error", `Import cycle: ${loop.join(" -> ")}`, {
          node: module,
          property: "name",
          code: "link/import-cycle",
        });
      for (const imp of module.imports) {
        const target = relative(uri, imp.path);
        if (!shared.workspace.LangiumDocuments.hasDocument(URI.parse(target)))
          accept("error", `Unavailable module ${imp.path}.`, {
            node: imp,
            property: "path",
            code: "link/missing-module",
          });
      }
    },
    Game(game, accept) {
      const uri = relative(AstUtils.getDocument(game).uri.toString(), game.path);
      const source = sources.get(uri);
      if (source === undefined)
        accept("error", `Unavailable PGN ${game.path}.`, {
          node: game,
          property: "path",
          code: "source/missing-game",
        });
      else {
        const result = analysis.replay(source);
        if (!result.ok)
          accept("error", result.error.message, {
            node: game,
            property: "path",
            code: "chess/invalid-game",
          });
      }
    },
    Scene(scene, accept) {
      const game = scene.game.ref;
      if (!game) return; // Langium reports the unresolved cross-reference.
      const source = sources.get(relative(AstUtils.getDocument(game).uri.toString(), game.path));
      if (source === undefined) return;
      const result = analysis.replay(source);
      if (!result.ok) return;
      for (const issue of analyzeScene(lowerScene(scene), result.value.frames)) {
        const noteIndex = issue.path[1];
        const node: AstNode = typeof noteIndex === "number" ? scene.notes[noteIndex] : scene;
        accept("error", issue.message, {
          node,
          property: String(issue.path.at(-1)),
          code: issue.code,
        });
      }
    },
  };
  language.validation.ValidationRegistry.register(checks);
  return { shared, language, analysis };
}

class ChessCompletion extends DefaultCompletionProvider {
  constructor(
    services: LangiumServices,
    private readonly sources: Sources,
    private readonly analysis: ReturnType<typeof createChessAnalysis>,
  ) {
    super(services);
  }
  override async getCompletion(document: LangiumDocument, params: CompletionParams) {
    const offset = document.textDocument.offsetAt(params.position);
    const prefix = document.textDocument.getText().slice(0, offset);
    const match = /answer\s+"([^"\n]*)$/.exec(prefix);
    if (match) {
      const scene = AstUtils.streamAllContents(document.parseResult.value)
        .filter(isScene)
        .find((s) => !!s.$cstNode && s.$cstNode.offset <= offset && s.$cstNode.end >= offset);
      const game = scene?.game.ref;
      if (scene && game) {
        const source = this.sources.get(
          relative(AstUtils.getDocument(game).uri.toString(), game.path),
        );
        const history = source === undefined ? undefined : this.analysis.replay(source);
        const position = history?.ok ? history.value.frames[scene.ply] : undefined;
        if (position) {
          const start = document.textDocument.positionAt(offset - match[1].length);
          const endQuote = document.textDocument.getText().indexOf('"', offset);
          const end = endQuote < 0 ? params.position : document.textDocument.positionAt(endQuote);
          return {
            isIncomplete: false,
            items: positionData(position).legalMoves.map((move) => ({
              label: move.san,
              detail: move.uci,
              textEdit: { range: { start, end }, newText: move.san },
            })),
          };
        }
      }
    }
    return super.getCompletion(document, params);
  }
}

class ChessValidator extends DefaultDocumentValidator {
  override async validateDocument(
    document: LangiumDocument,
    options?: ValidationOptions,
    token?: CancellationToken,
  ) {
    const diagnostics = await super.validateDocument(
      document,
      { ...options, stopAfterLexingErrors: true, stopAfterParsingErrors: true },
      token,
    );
    return diagnostics.map((diagnostic) => ({
      ...diagnostic,
      code:
        diagnostic.code ??
        (diagnostic.data?.code === "linking-error"
          ? "link/unresolved-game"
          : diagnostic.data?.code),
    }));
  }
}

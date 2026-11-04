// The transport uses Bun's Node compatibility; authored file acquisition uses Bun.
import { DocumentState, URI } from "langium";
import type { TextDocument } from "langium";
import { DefaultDocumentUpdateHandler, startLanguageServer } from "langium/lsp";
import type { LangiumSharedServices } from "langium/lsp";
import type {
  DidChangeWatchedFilesParams,
  TextDocumentChangeEvent,
} from "vscode-languageserver";
import { createConnection, ProposedFeatures } from "vscode-languageserver/node";

import { createBunFileSystem } from "../runtime/filesystem.js";
import { isNarrative } from "../runtime/narrative.js";
import { createSourceCache } from "../runtime/source-cache.js";
import { retainGameSources } from "../runtime/source-retention.js";
import { readSourceText, decodeSourceText } from "../runtime/source-text.js";
import { openResolver, isBareReference } from "../sources/index.js";
import { isModule, isGame } from "./100-parsing/index.js";
import { createServices, relative } from "./300-linking/index.js";
import { decode } from "./index.js";

const sources = new Map<string, string>();
const overlays = new Map<string, string>();
const connection = createConnection(ProposedFeatures.all);
const sourceReferences = new Map<string, string>();
let resolver: ReturnType<typeof openResolver> | undefined;
const getResolver = async () => {
  // oxlint-disable-next-line no-use-before-define -- Acquisition runs after the server services have been constructed and initialized.
  const folder = shared.workspace.WorkspaceManager.workspaceFolders?.[0]?.uri;
  const root =
    process.env.CHESS_SOURCE_ROOT === undefined
      ? new URL(
          folder === undefined
            ? Bun.pathToFileURL(`${process.cwd()}/`).href
            : `${folder.replace(/\/+$/u, "")}/`
        )
      : Bun.pathToFileURL(
          `${process.env.CHESS_SOURCE_ROOT.replace(/\/+$/u, "")}/`
        );
  return await (resolver ??= openResolver({ overlays, root }));
};
const retainAcquired = () => {
  retainGameSources(
    sources,
    overlays,
    sourceReferences,
    // oxlint-disable-next-line no-use-before-define -- Acquisition runs after editor services are constructed.
    analysis.setActiveSources
  );
};
const acquireSource = createSourceCache(sources, overlays, async (uri) => {
  try {
    const resolved = await getResolver();
    return decodeSourceText(
      await resolved.read(uri, sourceReferences.get(uri))
    );
  } catch (error) {
    connection.console.error(String(error));
    // Invalid provider configuration must not prevent ordinary local editing.
    if (new URL(uri).protocol === "file:" && !uri.includes("#")) {
      return await readSourceText(new URL(uri));
    }
    throw error;
  }
});

const acquire = async (
  uri: string,
  visited = new Set<string>(),
  reference?: string
): Promise<void> => {
  if (visited.has(uri)) {
    return;
  }
  visited.add(uri);
  if (reference !== undefined) {
    const existing = sourceReferences.get(uri);
    if (existing === undefined || isBareReference(existing)) {
      sourceReferences.set(uri, reference);
    }
  }
  const text = await acquireSource(uri);
  retainAcquired();
  if (text !== undefined && isNarrative(uri)) {
    const parsed = decode(text);
    if (parsed.ok) {
      await Promise.all(
        [
          ...parsed.value.imports,
          ...parsed.value.games.map((game) => game.source),
        ].map(async (path) => {
          await acquire(relative(uri, path), visited, path);
        })
      );
    }
  }
};

/** Handle artifact dependencies without asking Langium to parse PGN as narrative. */
class ArtifactUpdates extends DefaultDocumentUpdateHandler {
  private readonly shared: LangiumSharedServices;
  /**
   * Connect editor lifecycle events to the workspace.
   * @param services - Shared Langium services.
   */
  constructor(services: LangiumSharedServices) {
    super(services);
    this.shared = services;
  }
  private affected(changed: string[]): URI[] {
    const affected = new Set(changed);
    let growing = true;
    while (growing) {
      growing = false;
      for (const document of this.shared.workspace.LangiumDocuments.all) {
        const uri = document.uri.toString();
        const root = document.parseResult.value;
        if (
          !affected.has(uri) &&
          isModule(root) &&
          [
            ...root.imports.map((item) => item.path),
            ...root.declarations.filter(isGame).map((game) => game.path),
          ].some(
            (path) =>
              affected.has(relative(uri, path)) ||
              affected.has(relative(uri, path).split("#")[0])
          )
        ) {
          affected.add(uri);
          growing = true;
        }
      }
    }
    return [...affected]
      .filter((uri) => isNarrative(uri))
      .map((uri) => URI.parse(uri));
  }
  /**
   * Keep open buffers authoritative and rebuild affected lessons.
   * @param event - Latest editor buffer.
   */
  override didChangeContent(
    event: TextDocumentChangeEvent<TextDocument>
  ): void {
    overlays.set(event.document.uri, event.document.getText());
    sources.set(event.document.uri, event.document.getText());
    this.fireDocumentUpdate(this.affected([event.document.uri]), []);
  }
  /**
   * Restore disk content after an unsaved buffer closes.
   * @param event - Closed editor document.
   */
  async didCloseDocument(
    event: TextDocumentChangeEvent<TextDocument>
  ): Promise<void> {
    overlays.delete(event.document.uri);
    await acquire(event.document.uri);
    this.fireDocumentUpdate(this.affected([event.document.uri]), []);
  }
  /**
   * Invalidate lessons that refer to changed chess artifacts.
   * @param params - Client filesystem notifications.
   */
  override didChangeWatchedFiles(params: DidChangeWatchedFilesParams): void {
    void this.refreshWatched(params);
  }
  private async refreshWatched(
    params: DidChangeWatchedFilesParams
  ): Promise<void> {
    this.onWatchedFilesChangeEmitter.fire(params);
    await Promise.all(
      params.changes.map(async (change) => {
        await acquire(change.uri);
        await Promise.all(
          [...sources.keys()]
            .filter(
              (uri) => uri !== change.uri && uri.split("#")[0] === change.uri
            )
            .map(async (uri) => {
              await acquire(uri);
            })
        );
      })
    );
    const deleted = params.changes
      .filter(
        (change) =>
          change.type === 3 &&
          !overlays.has(change.uri) &&
          isNarrative(change.uri)
      )
      .map((change) => URI.parse(change.uri));
    const removed = new Set(deleted.map((uri) => uri.toString()));
    this.fireDocumentUpdate(
      this.affected(params.changes.map((change) => change.uri)).filter(
        (uri) => !removed.has(uri.toString())
      ),
      deleted
    );
  }
}
const { shared, analysis } = createServices(
  sources,
  {
    connection,
    fileSystemProvider: () => {
      const files = createBunFileSystem(sources);
      return {
        ...files,
        readFile: async (uri) => {
          await acquire(uri.toString());
          const text = sources.get(uri.toString());
          if (text === undefined) {
            throw new Error(`Unavailable narrative source ${uri.toString()}.`);
          }
          return text;
        },
      };
    },
  },
  undefined,
  (services) => new ArtifactUpdates(services)
);
const refreshReferencePolicies = () => {
  // Collect policies before concurrent reads; a bare name cannot weaken an explicit file.
  sourceReferences.clear();
  for (const current of shared.workspace.LangiumDocuments.all) {
    const module = current.parseResult.value;
    if (!isModule(module)) {
      continue;
    }
    for (const path of [
      ...module.imports.map((item) => item.path),
      ...module.declarations.filter(isGame).map((game) => game.path),
    ]) {
      const target = relative(current.uri.toString(), path);
      const prior = sourceReferences.get(target);
      if (prior === undefined || isBareReference(prior)) {
        sourceReferences.set(target, path);
      }
    }
  }
};
shared.workspace.DocumentBuilder.onUpdate(() => {
  refreshReferencePolicies();
  retainAcquired();
});
const publish = connection.sendDiagnostics.bind(connection);
connection.sendDiagnostics = async (params) => {
  await publish({
    ...params,
    version: shared.workspace.LangiumDocuments.getDocument(
      URI.parse(params.uri)
    )?.textDocument.version,
  });
};
shared.workspace.DocumentBuilder.onDocumentPhase(
  DocumentState.Parsed,
  async (document) => {
    const uri = document.uri.toString();
    sources.set(uri, document.textDocument.getText());
    const root = document.parseResult.value;
    refreshReferencePolicies();
    if (isModule(root)) {
      await Promise.all(
        [
          ...root.imports.map((item) => item.path),
          ...root.declarations.filter(isGame).map((game) => game.path),
        ].map(async (path) => {
          await acquire(relative(uri, path), new Set(), path);
        })
      );
      retainAcquired();
      try {
        const resolved = await getResolver();
        if (resolved.configured) {
          await resolved.finish();
        }
      } catch (error) {
        connection.console.error(String(error));
      }
    }
  }
);
startLanguageServer(shared);

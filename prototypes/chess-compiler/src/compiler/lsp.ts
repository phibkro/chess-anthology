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
import { createSourceCache } from "../runtime/source-cache.js";
import { readSourceText } from "../runtime/source-text.js";
import { isModule, isGame } from "./100-parsing/index.js";
import { createServices, relative } from "./300-linking/index.js";
import { decode } from "./index.js";

const sources = new Map<string, string>();
const overlays = new Map<string, string>();
const connection = createConnection(ProposedFeatures.all);
const acquireSource = createSourceCache(
  sources,
  overlays,
  async (uri) => await readSourceText(new URL(uri))
);

const acquire = async (
  uri: string,
  visited = new Set<string>()
): Promise<void> => {
  if (visited.has(uri)) {
    return;
  }
  visited.add(uri);
  const text = await acquireSource(uri);
  if (text !== undefined && uri.endsWith(".chess-story")) {
    const parsed = decode(text);
    if (parsed.ok) {
      await Promise.all(
        [
          ...parsed.value.imports,
          ...parsed.value.games.map((game) => game.source),
        ].map(async (path) => {
          await acquire(relative(uri, path), visited);
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
          ].some((path) => affected.has(relative(uri, path)))
        ) {
          affected.add(uri);
          growing = true;
        }
      }
    }
    return [...affected]
      .filter((uri) => uri.endsWith(".chess-story"))
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
      })
    );
    const deleted = params.changes
      .filter(
        (change) =>
          change.type === 3 &&
          !overlays.has(change.uri) &&
          change.uri.endsWith(".chess-story")
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
const { shared } = createServices(
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
    if (isModule(root)) {
      await Promise.all(
        [
          ...root.imports.map((item) => item.path),
          ...root.declarations.filter(isGame).map((game) => game.path),
        ].map(async (path) => {
          await acquire(relative(uri, path));
        })
      );
    }
  }
);
startLanguageServer(shared);

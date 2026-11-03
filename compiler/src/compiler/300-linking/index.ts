import { URI, EmptyFileSystemProvider, DocumentState } from "langium";
import type { LangiumDocument } from "langium";

import { isModule, isGame } from "../100-parsing/index.js";
import { createChessAnalysis } from "../400-chess-analysis/index.js";
import { createServices, relative } from "./langium.js";
import type { Sources } from "./langium.js";

export { relative, createServices } from "./langium.js";
export type { Sources } from "./langium.js";
// Own the mutable Langium workspace here; never place its objects in build snapshots.
const dependencies = (document: LangiumDocument): string[] => {
  const root = document.parseResult.value;
  return isModule(root)
    ? [
        ...root.imports.map((i) => i.path),
        ...root.declarations.filter(isGame).map((g) => g.path),
      ].map((path) => relative(document.uri.toString(), path))
    : [];
};

/**
 * Create an incremental in-memory workspace with dependency invalidation.
 * @param analysis - Shared chess replay analysis for this workspace.
 * @returns Create an incremental in-memory workspace with dependency invalidation.
 */
export const createWorkspace = (analysis = createChessAnalysis()) => {
  const sources: Sources = new Map();
  class MemoryFiles extends EmptyFileSystemProvider {
    private readonly content = sources;
    override readFileSync(uri?: URI) {
      return this.content.get(uri?.toString() ?? "") ?? "";
    }
    // oxlint-disable-next-line require-await -- Langium requires a Promise lifecycle API backed by this synchronous in-memory cache.
    override async readFile(uri?: URI) {
      return this.readFileSync(uri);
    }
    override existsSync(uri?: URI) {
      return this.content.has(uri?.toString() ?? "");
    }
    // oxlint-disable-next-line require-await -- Langium requires a Promise lifecycle API backed by this synchronous in-memory cache.
    override async exists(uri?: URI) {
      return this.existsSync(uri);
    }
    override statSync(uri: URI) {
      return {
        isDirectory: false,
        isFile: this.content.has(uri?.toString() ?? ""),
        uri,
      };
    }
    // oxlint-disable-next-line require-await -- Langium requires a Promise lifecycle API backed by this synchronous in-memory cache.
    override async stat(uri: URI) {
      return this.statSync(uri);
    }
  }
  const services = createServices(
    sources,
    { fileSystemProvider: () => new MemoryFiles() },
    analysis
  );
  const documents = services.shared.workspace.LangiumDocuments;
  const builder = services.shared.workspace.DocumentBuilder;
  let parsed = 0;
  const validated = new Set<string>();
  builder.onDocumentPhase(DocumentState.Parsed, () => {
    parsed += 1;
  });
  builder.onDocumentPhase(DocumentState.Validated, (doc) => {
    validated.add(doc.uri.toString());
  });
  const update = async (next: ReadonlyMap<string, string>) => {
    parsed = 0;
    validated.clear();
    const changed = [...next]
      .filter(([uri, text]) => sources.get(uri) !== text)
      .map(([uri]) => uri);
    const deleted = [...sources.keys()].filter((uri) => !next.has(uri));
    const affected = new Set([...changed, ...deleted]);
    const reverse = new Map<string, string[]>();
    for (const document of documents.all) {
      for (const dep of dependencies(document)) {
        reverse.set(dep, [
          ...(reverse.get(dep) ?? []),
          document.uri.toString(),
        ]);
      }
    }
    const queue = [...affected];
    for (const queued of queue) {
      for (const dependent of reverse.get(queued) ?? []) {
        if (!affected.has(dependent)) {
          affected.add(dependent);
          queue.push(dependent);
        }
      }
    }
    for (const [uri, text] of next) {
      sources.set(uri, text);
    }
    for (const uri of deleted) {
      sources.delete(uri);
    }
    // Imports and PGN paths are dependency edges even without a resolved Langium reference.
    for (const uri of affected) {
      const document = documents.getDocument(URI.parse(uri));
      if (document && !changed.includes(uri) && !deleted.includes(uri)) {
        builder.resetToState(document, DocumentState.ComputedScopes);
      }
    }
    if (changed.length || deleted.length) {
      await builder.update(
        changed
          .filter((uri) => uri.endsWith(".chess-story"))
          .map((uri) => URI.parse(uri)),
        deleted
          .filter((uri) => uri.endsWith(".chess-story"))
          .map((uri) => URI.parse(uri))
      );
    }
    return { changed, deleted, parsed, validated: [...validated] };
  };
  return { analysis, documents, sources, update };
};

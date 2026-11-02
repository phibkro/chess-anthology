import { URI, EmptyFileSystemProvider, DocumentState, type LangiumDocument } from "langium";
import { createServices, relative, type Sources } from "./langium.js";
import { isModule, isGame } from "../100-parsing/index.js";
import { createChessAnalysis } from "../400-chess-analysis/index.js";

export { relative, createServices } from "./langium.js";
export type { Sources } from "./langium.js";
// Own the mutable Langium workspace here; never place its objects in build snapshots.
export function createWorkspace(analysis = createChessAnalysis()) {
  const sources: Sources = new Map();
  class MemoryFiles extends EmptyFileSystemProvider {
    override readFileSync(uri?: URI) {
      return sources.get(uri?.toString() ?? "") ?? "";
    }
    override async readFile(uri?: URI) {
      return this.readFileSync(uri);
    }
    override existsSync(uri?: URI) {
      return sources.has(uri?.toString() ?? "");
    }
    override async exists(uri?: URI) {
      return this.existsSync(uri);
    }
    override statSync(uri: URI) {
      return { uri, isFile: sources.has(uri?.toString() ?? ""), isDirectory: false };
    }
    override async stat(uri: URI) {
      return this.statSync(uri);
    }
  }
  const services = createServices(
    sources,
    { fileSystemProvider: () => new MemoryFiles() },
    analysis,
  );
  const documents = services.shared.workspace.LangiumDocuments;
  const builder = services.shared.workspace.DocumentBuilder;
  let parsed = 0;
  const validated = new Set<string>();
  builder.onDocumentPhase(DocumentState.Parsed, () => {
    parsed++;
  });
  builder.onDocumentPhase(DocumentState.Validated, (doc) => {
    validated.add(doc.uri.toString());
  });
  function dependencies(document: LangiumDocument): string[] {
    const root = document.parseResult.value;
    return isModule(root)
      ? [
          ...root.imports.map((i) => i.path),
          ...root.declarations.filter(isGame).map((g) => g.path),
        ].map((path) => relative(document.uri.toString(), path))
      : [];
  }
  async function update(next: ReadonlyMap<string, string>) {
    parsed = 0;
    validated.clear();
    const changed = [...next]
      .filter(([uri, text]) => sources.get(uri) !== text)
      .map(([uri]) => uri);
    const deleted = [...sources.keys()].filter((uri) => !next.has(uri));
    const affected = new Set([...changed, ...deleted]);
    const reverse = new Map<string, string[]>();
    for (const document of documents.all)
      for (const dep of dependencies(document))
        reverse.set(dep, [...(reverse.get(dep) ?? []), document.uri.toString()]);
    const queue = [...affected];
    for (let i = 0; i < queue.length; i++)
      for (const dependent of reverse.get(queue[i]) ?? [])
        if (!affected.has(dependent)) {
          affected.add(dependent);
          queue.push(dependent);
        }
    for (const [uri, text] of next) sources.set(uri, text);
    for (const uri of deleted) sources.delete(uri);
    // Imports and PGN paths are dependency edges even without a resolved Langium reference.
    for (const uri of affected) {
      const document = documents.getDocument(URI.parse(uri));
      if (document && !changed.includes(uri) && !deleted.includes(uri))
        builder.resetToState(document, DocumentState.ComputedScopes);
    }
    if (changed.length || deleted.length)
      await builder.update(
        changed.filter((uri) => uri.endsWith(".chess-story")).map((uri) => URI.parse(uri)),
        deleted.filter((uri) => uri.endsWith(".chess-story")).map((uri) => URI.parse(uri)),
      );
    return { changed, deleted, parsed, validated: [...validated] };
  }
  return { update, documents, sources, analysis };
}

// The library's stdio transport uses Bun's Node compatibility internally;
// authored acquisition and filesystem code use Bun APIs.
import { DocumentState } from "langium";
import { startLanguageServer } from "langium/lsp";
import { createConnection, ProposedFeatures } from "vscode-languageserver/node";

import { createBunFileSystem } from "../runtime/filesystem.js";
import { readSourceText } from "../runtime/source-text.js";
import { isModule, isGame } from "./100-parsing/index.js";
import { createServices, relative } from "./300-linking/index.js";

const sources = new Map<string, string>();
const connection = createConnection(ProposedFeatures.all);
const { shared } = createServices(sources, {
  connection,
  fileSystemProvider: () => createBunFileSystem(sources),
});
shared.workspace.DocumentBuilder.onDocumentPhase(
  DocumentState.Parsed,
  async (document) => {
    const root = document.parseResult.value;
    sources.set(document.uri.toString(), document.textDocument.getText());
    if (!isModule(root)) {
      return;
    }
    const paths = [
      ...root.imports.map((item) => item.path),
      ...root.declarations.filter(isGame).map((game) => game.path),
    ];
    await Promise.all(
      paths.map(async (path) => {
        const uri = relative(document.uri.toString(), path);
        try {
          sources.set(uri, await readSourceText(new URL(uri)));
        } catch {
          sources.delete(uri);
        }
      })
    );
  }
);
startLanguageServer(shared);

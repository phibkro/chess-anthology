// PROTOTYPE Node adapter. Narrative files are managed by Langium's workspace.
import { readFileSync } from "node:fs";

import { startLanguageServer } from "langium/lsp";
import { NodeFileSystem } from "langium/node";
import { createConnection, ProposedFeatures } from "vscode-languageserver/node";

import { createServices } from "./300-linking/index.js";
class FileSources extends Map<string, string> {
  override get(uri: string) {
    try {
      return readFileSync(new URL(uri), "utf8");
    } catch {
      return undefined;
    }
  }
}
const connection = createConnection(ProposedFeatures.all);
const { shared } = createServices(new FileSources(), {
  ...NodeFileSystem,
  connection,
});
startLanguageServer(shared);

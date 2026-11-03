import { DefaultScopeProvider, AstUtils } from "langium";
import type { ReferenceInfo } from "langium";

import { isScene, isModule, isGame } from "../100-parsing/index.js";
import { relative } from "./source-uri.js";
/** Enforce explicit import visibility for game references. */
export class ImportScope extends DefaultScopeProvider {
  /**
   * Resolve visible local and explicitly imported games.
   * @param context - The cross-reference being resolved.
   * @returns A scope restricted to the containing module and its imports.
   */
  override getScope(context: ReferenceInfo) {
    if (!isScene(context.container)) {
      return super.getScope(context);
    }
    const document = AstUtils.getDocument(context.container);
    const root = document.parseResult.value;
    if (!isModule(root)) {
      return super.getScope(context);
    }
    const imported = new Set(
      root.imports.map((i) => relative(document.uri.toString(), i.path))
    );
    // Explicit import visibility; an unrelated workspace module cannot satisfy a reference.
    const exported = this.indexManager
      .allElements("Game")
      .filter((d) => imported.has(d.documentUri.toString()));
    return this.createScopeForNodes(
      root.declarations.filter(isGame),
      this.createScope(exported)
    );
  }
}

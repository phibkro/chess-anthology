import {
  createDefaultCoreModule,
  createDefaultSharedCoreModule,
  EmptyFileSystem,
  inject,
} from "langium";

import { isModule, type Module } from "./generated/ast.js";
import {
  ChessNarrativeGeneratedModule,
  ChessNarrativeGeneratedSharedModule,
} from "./generated/module.js";
import { jsonParserModule } from "./json-string.js";
export { jsonParserModule } from "./json-string.js";
import { ok, err, type Result } from "../../contracts/index.js";
export {
  isModule,
  isGame,
  isStory,
  isScene,
  isText,
  isArrow,
} from "./generated/ast.js";
const shared = inject(
  createDefaultSharedCoreModule(EmptyFileSystem),
  ChessNarrativeGeneratedSharedModule
);
const language = inject(
  createDefaultCoreModule({ shared }),
  ChessNarrativeGeneratedModule,
  jsonParserModule
);
shared.ServiceRegistry.register(language);
export function parseText(source: string): Result<Module> {
  try {
    const parsed = language.parser.LangiumParser.parse(source);
    if (
      parsed.lexerErrors.length ||
      parsed.parserErrors.length ||
      !isModule(parsed.value)
    )
      return err(
        "syntax",
        "source/invalid-syntax",
        [...parsed.lexerErrors, ...parsed.parserErrors]
          .map((e) => e.message)
          .join("\n")
      );
    return ok(parsed.value);
  } catch (error) {
    return err("infrastructure", "parser/failure", String(error));
  }
}

export {
  ChessNarrativeGeneratedModule,
  ChessNarrativeGeneratedSharedModule,
} from "./generated/module.js";

export type { Module, Scene, ChessNarrativeAstType } from "./contract.js";

import {
  createDefaultCoreModule,
  createDefaultSharedCoreModule,
  EmptyFileSystem,
  inject,
} from "langium";

import { ok, err } from "../../contracts/index.js";
import type { Result } from "../../contracts/index.js";
import { isModule } from "./generated/ast.js";
import type { Module } from "./generated/ast.js";
import {
  ChessNarrativeGeneratedModule,
  ChessNarrativeGeneratedSharedModule,
} from "./generated/module.js";
import { jsonParserModule } from "./json-string.js";
import { installMarkdownParser } from "./markdown.js";

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
installMarkdownParser(language.parser.LangiumParser);
shared.ServiceRegistry.register(language);
/**
 * Parse flat narrative text and return syntax failures as values.
 * @param source - Narrative or game source text.
 * @returns A syntax root or an explicit parsing failure.
 */
export const parseText = (source: string): Result<Module> => {
  try {
    const parsed = language.parser.LangiumParser.parse(source);
    if (
      parsed.lexerErrors.length ||
      parsed.parserErrors.length ||
      !isModule(parsed.value)
    ) {
      return err(
        "syntax",
        "source/invalid-syntax",
        [...parsed.lexerErrors, ...parsed.parserErrors]
          .map((e) => e.message)
          .join("\n")
      );
    }
    return ok(parsed.value);
  } catch (error) {
    return err("infrastructure", "parser/failure", String(error));
  }
};

export {
  ChessNarrativeGeneratedModule,
  ChessNarrativeGeneratedSharedModule,
} from "./generated/module.js";

export type { Module, Scene, ChessNarrativeAstType } from "./contract.js";

export { jsonParserModule } from "./json-string.js";

export {
  installMarkdownParser,
  markdownAuthoring,
  markdownScene,
  markdownDiagnostics,
} from "./markdown.js";

export { syntaxDependencies } from "./markdown.js";

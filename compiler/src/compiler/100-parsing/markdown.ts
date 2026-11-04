import type { AstNode, LangiumParser, ParserOptions } from "langium";
import type { Diagnostic } from "vscode-languageserver";

import type { MarkdownSyntax, Span } from "../../authoring/markdown.js";
import { parseMarkdown } from "../../authoring/markdown.js";
import type { AuthoringData } from "../../contracts/authored.js";
import type { Result } from "../../contracts/core.js";
import { isModule, isStory } from "./generated/ast.js";

interface Projection {
  source: string;
  syntax: Result<MarkdownSyntax>;
  lines: Span[];
}
const projections = new WeakMap<AstNode, Projection>();
const sceneData = new WeakMap<
  AstNode,
  AuthoringData["stories"][number]["scenes"][number]
>();

/** Original authored data accompanies the private linking projection.
 * @param node - Private linking AST root.
 * @returns Original authored syntax, when this is Markdown.
 */
export const markdownAuthoring = (node: AstNode) =>
  projections.get(node)?.syntax;
/** Scene checks consume rich authored notes through the same semantic seam.
 * @param node - Private scene AST node.
 * @returns Authored scene data, when this is Markdown.
 */
export const markdownScene = (node: AstNode) => sceneData.get(node);

/** Install a Markdown frontend while retaining the existing Langium linker.
 * @param parser - Existing Langium parser instance.
 */
export const installMarkdownParser = (parser: LangiumParser) => {
  const parse = parser.parse.bind(parser);
  parser.parse = <T extends AstNode = AstNode>(
    source: string,
    options?: ParserOptions
  ) => {
    if (!/^(?:\uFEFF)?---(?:\r?\n|$)/u.test(source)) {
      return parse<T>(source, options);
    }
    const syntax = parseMarkdown(source);
    const projection: Projection = { lines: [], source, syntax };
    const lines: string[] = [];
    const append = (
      text: string,
      item:
        | AuthoringData
        | AuthoringData["games"][number]
        | AuthoringData["stories"][number]
        | AuthoringData["stories"][number]["scenes"][number]
        | AuthoringData["stories"][number]["scenes"][number]["notes"][number]
    ) => {
      lines.push(text);
      projection.lines.push(
        syntax.ok
          ? (syntax.value.spans.get(item) ?? { end: 0, start: 0 })
          : { end: 0, start: 0 }
      );
    };
    if (syntax.ok) {
      const { data } = syntax.value;
      append(`module ${data.name};`, data);
      for (const path of data.imports) {
        append(`import ${JSON.stringify(path)};`, data);
      }
      for (const game of data.games) {
        append(
          `${game.exported ? "export " : ""}game ${game.name} from ${JSON.stringify(game.source)};`,
          game
        );
      }
      for (const story of data.stories) {
        append(`story ${story.name} {`, story);
        for (const scene of story.scenes) {
          append(
            `board ${scene.name} game ${scene.game} after ${scene.ply} {`,
            scene
          );
          for (const note of scene.notes) {
            if (note.type === "arrow") {
              append(
                `arrow ${JSON.stringify(note.from)} -> ${JSON.stringify(note.to)} ${note.color};`,
                note
              );
            } else if (note.type === "prompt") {
              append(
                `prompt ${JSON.stringify(note.text)} answer ${JSON.stringify(note.answer)};`,
                note
              );
            } else {
              append(
                `text ${JSON.stringify(note.type === "text" ? note.text : "")};`,
                note
              );
            }
          }
          append("}", scene);
        }
        append("}", story);
      }
    } else {
      lines.push("module invalidMarkdown;");
    }
    const parsed = parse<T>(lines.join("\n"), options);
    projections.set(parsed.value, projection);
    // Match the framework's syntax nodes by declaration order, not display title.
    if (syntax.ok && isModule(parsed.value)) {
      for (const [storyIndex, declaration] of parsed.value.declarations
        .filter(isStory)
        .entries()) {
        const story = syntax.value.data.stories[storyIndex];
        for (const [index, scene] of declaration.scenes.entries()) {
          sceneData.set(scene, story.scenes[index]);
        }
      }
    }
    return parsed;
  };
};

const position = (source: string, offset: number) => {
  const before = source.slice(0, offset);
  return {
    character: offset - before.lastIndexOf("\n") - 1,
    line: before.split("\n").length - 1,
  };
};
/** Map generated linking diagnostics back to original Markdown constructs.
 * @param root - Private linking AST root.
 * @param diagnostics - Diagnostics in generated source coordinates.
 * @returns Diagnostics in original Markdown coordinates.
 */
export const markdownDiagnostics = (
  root: AstNode,
  diagnostics: Diagnostic[]
): Diagnostic[] => {
  const projection = projections.get(root);
  if (!projection) {
    return diagnostics;
  }
  if (!projection.syntax.ok) {
    return [
      {
        code: projection.syntax.error.code,
        message: projection.syntax.error.message,
        range: {
          end: position(projection.source, projection.source.length),
          start: { character: 0, line: 0 },
        },
        severity: 1,
      },
    ];
  }
  return diagnostics.map((diagnostic) => {
    const start = projection.lines[diagnostic.range.start.line] ?? {
      end: 0,
      start: 0,
    };
    const end = projection.lines[diagnostic.range.end.line] ?? start;
    return {
      ...diagnostic,
      range: {
        end: position(projection.source, end.end),
        start: position(projection.source, start.start),
      },
    };
  });
};

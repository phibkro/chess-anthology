import type { LangiumDocument } from "langium";
import type { Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import type { CompletionItem, CompletionParams } from "vscode-languageserver";

import { frontmatterSchema } from "../contracts/authored.js";
import { readFrontmatter } from "./frontmatter.js";
import { parseMarkdown } from "./reader.js";

const insideInlineCode = (node: Nodes, offset: number): boolean => {
  if (node.type === "inlineCode") {
    return (
      (node.position?.start.offset ?? Infinity) <= offset &&
      (node.position?.end.offset ?? -1) >= offset
    );
  }
  return (
    "children" in node &&
    node.children.some((child) => insideInlineCode(child, offset))
  );
};
const directiveContext = (source: string, offset: number) => {
  try {
    const header = readFrontmatter(source);
    const local = offset - header.body;
    return fromMarkdown(source.slice(header.body)).children.some(
      (node) =>
        node.type === "paragraph" &&
        (node.position?.start.offset ?? Infinity) <= local &&
        (node.position?.end.offset ?? -1) >= local &&
        !insideInlineCode(node, local)
    );
  } catch {
    return false;
  }
};

const completionEnd = (source: string, offset: number, pattern: RegExp) =>
  offset + (pattern.exec(source.slice(offset))?.[0].length ?? 0);

/** Suggest frontmatter keys and directive values in original Markdown coordinates.
 * @param document - Open Markdown document.
 * @param params - Cursor position.
 * @returns A completion request and its source replacement range.
 */
export const markdownCompletion = (
  document: LangiumDocument,
  params: CompletionParams
) => {
  const source = document.textDocument.getText();
  const offset = document.textDocument.offsetAt(params.position);
  const prefix = source.slice(0, offset);
  const lineStart = prefix.lastIndexOf("\n") + 1;
  const line = prefix.slice(lineStart);
  const range = {
    end: params.position,
    start: document.textDocument.positionAt(lineStart),
  };
  if (
    /^(?:\uFEFF)?---\r?\n/u.test(prefix) &&
    !/^---[ \t]*\r?$/mu.test(prefix.slice(prefix.indexOf("\n") + 1))
  ) {
    const items: CompletionItem[] = Object.keys(frontmatterSchema.entries).map(
      (key) => ({
        kind: 10,
        label: key,
        textEdit: { newText: `${key}: `, range },
      })
    );
    return {
      items: /^[a-zA-Z]*$/u.test(line) ? items : [],
      kind: "items" as const,
    };
  }
  if (!directiveContext(source, offset)) {
    return { items: [], kind: "items" as const };
  }
  const board = /^@board[ \t]+(?<game>[^\s]*)$/u.exec(line);
  if (board) {
    try {
      const header = readFrontmatter(source);
      return {
        imports: header.data.imports ?? [],
        kind: "games" as const,
        names: Object.keys(header.data.games ?? {}),
        range: {
          ...range,
          end: document.textDocument.positionAt(
            completionEnd(source, offset, /^[^\s]*/u)
          ),
          start: document.textDocument.positionAt(offset - board[1].length),
        },
      };
    } catch {
      return { items: [], kind: "items" as const };
    }
  }
  const answer = /^@answer[ \t]+(?<move>.*)$/u.exec(line);
  if (answer) {
    // The parser accepts draft SAN, but an empty answer needs a placeholder.
    const draft = `${source.slice(0, offset)}a1${source.slice(offset)}`;
    const parsed = parseMarkdown(draft);
    if (!parsed.ok) {
      return { items: [], kind: "items" as const };
    }
    let selected: { game: string; ply: number } | undefined;
    for (const story of parsed.value.data.stories) {
      for (const scene of story.scenes) {
        const span = parsed.value.boards.get(`${story.name}/${scene.name}`);
        if (span && span.start <= offset && "game" in scene) {
          selected = scene;
        }
      }
    }
    if (selected) {
      return {
        kind: "answer" as const,
        ...selected,
        data: parsed.value.data,
        range: {
          ...range,
          end: document.textDocument.positionAt(
            completionEnd(source, offset, /^[^\r\n]*/u)
          ),
          start: document.textDocument.positionAt(offset - answer[1].length),
        },
      };
    }
  }
  const items: CompletionItem[] = /^@[a-z]*$/u.test(line)
    ? ["id", "board", "arrow", "prompt", "answer"].map((name) => ({
        label: `@${name}`,
        textEdit: { newText: `@${name} `, range },
      }))
    : [];
  return { items, kind: "items" as const };
};

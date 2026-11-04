import type { Text } from "mdast";
import { toMarkdown } from "mdast-util-to-markdown";
import * as v from "valibot";
import { isScalar, stringify } from "yaml";

import { authoringSchema, compositionSchema } from "../contracts/authored.js";
import { err, ok } from "../contracts/core.js";
import type { Result } from "../contracts/core.js";
import { readFrontmatter } from "./frontmatter.js";
import { parseMarkdown } from "./reader.js";

export { parseMarkdown } from "./reader.js";
export type { MarkdownSyntax, Span } from "./reader.js";

const heading = (title: string) =>
  toMarkdown({
    children: [
      { children: [{ type: "text", value: title }], type: "paragraph" },
    ],
    type: "root",
  }).trimEnd();

/** Print representable authoring ASTs; refuse any conversion that loses meaning.
 * @param input - Untrusted JSON authoring AST.
 * @returns Canonical Markdown or an explicit representation failure.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Public codec validates external AST data with the authoring schema.
export const printMarkdown = (input: unknown): Result<string> => {
  const checked = v.safeParse(
    v.variant("formatVersion", [authoringSchema, compositionSchema]),
    input
  );
  if (!checked.success) {
    return err(
      "schema",
      "document/invalid-shape",
      "Invalid Markdown authoring AST."
    );
  }
  const data = checked.output;
  try {
    const header = {
      ...data.metadata,
      exports:
        data.formatVersion === 2
          ? data.exports
          : data.games.filter((game) => game.exported).map((game) => game.name),
      games: Object.fromEntries(
        data.games.map((game) => [game.name, game.source])
      ),
      id: data.name,
      imports: data.imports,
    };
    const frontmatter =
      data.formatVersion === 2
        ? {
            ...header,
            collections: Object.fromEntries(
              data.collections.map((collection) => [
                collection.name,
                collection.members.map((member) => ({
                  as: member.name,
                  use: member.reference,
                })),
              ])
            ),
            uses: Object.fromEntries(
              data.uses.map((binding) => [binding.name, binding.source])
            ),
          }
        : header;
    const lines = ["---", stringify(frontmatter).trimEnd(), "---", ""];
    for (const story of data.stories) {
      lines.push(`# ${heading(story.title)}`, `@id ${story.name}`, "");
      for (const scene of story.scenes) {
        if ("type" in scene) {
          lines.push(`@include ${scene.reference} as ${scene.name}`, "");
          continue;
        }
        lines.push(
          `## ${heading(scene.title)}`,
          `@id ${scene.name}`,
          `@board ${scene.game} after ${scene.ply}`,
          ""
        );
        for (const note of scene.notes) {
          if (note.type === "markdown") {
            // Escape directive-looking prose, including lines created by wrapping.
            lines.push(
              toMarkdown(note.content, {
                handlers: {
                  text(node: Text, _parent, state, info) {
                    return state
                      .safe(node.value, info)
                      .replaceAll(/^@/gmu, "\\@");
                  },
                },
              }).trimEnd(),
              ""
            );
          } else if (note.type === "arrow") {
            lines.push(`@arrow ${note.from} -> ${note.to} ${note.color}`, "");
          } else if (note.type === "prompt") {
            lines.push(`@prompt ${note.text}`, `@answer ${note.answer}`, "");
          } else {
            lines.push(`@text ${JSON.stringify(note.text)}`, "");
          }
        }
      }
    }
    const source = lines.join("\n");
    const reparsed = parseMarkdown(source);
    if (!reparsed.ok || !Bun.deepEquals(reparsed.value.data, data, true)) {
      return err(
        "schema",
        "codec/unrepresentable-markdown",
        "This AST has no lossless representation in the supported Markdown subset."
      );
    }
    return ok(source);
  } catch (error) {
    return err("schema", "codec/unrepresentable-markdown", String(error));
  }
};

/** Edit an existing scalar without rewriting YAML comments or the document body.
 * @param source - Current source text.
 * @param path - Existing YAML scalar path.
 * @param value - Replacement string value.
 * @returns Edited source or a validation failure.
 */
export const editMarkdownMetadata = (
  source: string,
  path: string[],
  value: string
): Result<string> => {
  try {
    const parsed = parseMarkdown(source);
    if (!parsed.ok) {
      return parsed;
    }
    const header = readFrontmatter(source);
    const node: unknown = header.yaml.getIn(path, true);
    if (!isScalar(node) || !node.range) {
      return err(
        "selection",
        "codec/missing-scalar",
        "Select an existing frontmatter scalar."
      );
    }
    const start = header.start + node.range[0];
    const end = header.start + node.range[1];
    const trailingNewline = /\r?\n$/u.exec(source.slice(start, end))?.[0] ?? "";
    const result = `${source.slice(0, start)}${JSON.stringify(value)}${trailingNewline}${source.slice(end)}`;
    const checked = parseMarkdown(result);
    return checked.ok ? ok(result) : checked;
  } catch (error) {
    return err("schema", "codec/invalid-edit", String(error));
  }
};

/** Replace one board directive; every byte outside that range remains untouched.
 * @param source - Current source text.
 * @param story - Stable story identity.
 * @param scene - Stable scene identity.
 * @param game - Replacement game binding.
 * @param ply - Replacement mainline ply.
 * @returns Edited source or a validation failure.
 */
export const editMarkdownBoard = (
  source: string,
  story: string,
  scene: string,
  game: string,
  ply: number
): Result<string> => {
  const parsed = parseMarkdown(source);
  if (!parsed.ok) {
    return parsed;
  }
  const span = parsed.value.boards.get(`${story}/${scene}`);
  if (span === undefined) {
    return err(
      "selection",
      "codec/missing-board",
      "Board directive is unavailable."
    );
  }
  const result = `${source.slice(0, span.start)}@board ${game} after ${ply}${source.slice(span.end)}`;
  const checked = parseMarkdown(result);
  return checked.ok ? ok(result) : checked;
};

import * as v from "valibot";
import { parseDocument } from "yaml";

import { frontmatterSchema } from "../contracts/authored.js";

/** Read and validate the embedded YAML document.
 * @param source - Original Markdown source.
 * @returns Parsed YAML with validated frontmatter and source offsets.
 */
export const readFrontmatter = (source: string) => {
  const match =
    /^(?:\uFEFF)?---\r?\n(?<yaml>[\s\S]*?)^---[ \t]*(?:\r?\n|$)/mu.exec(source);
  if (!match || match.index !== 0) {
    throw new Error("Markdown requires YAML frontmatter delimited by ---.");
  }
  const start = source.indexOf("\n") + 1;
  const text = match.groups?.yaml ?? "";
  const yaml = parseDocument(text, {
    keepSourceTokens: true,
    schema: "core",
    uniqueKeys: true,
  });
  if (yaml.errors.length || yaml.warnings.length) {
    throw new Error(
      [...yaml.errors, ...yaml.warnings]
        .map((error) => error.message)
        .join("\n")
    );
  }
  const data: unknown = yaml.toJS({ maxAliasCount: 0 });
  return {
    body: match[0].length,
    data: v.parse(frontmatterSchema, data),
    end: start + text.length,
    start,
    yaml,
  };
};

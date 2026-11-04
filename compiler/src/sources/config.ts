import {
  applyEdits,
  modify,
  parse,
  printParseErrorCode,
  visit,
} from "jsonc-parser";
import type { ParseError } from "jsonc-parser";
import * as v from "valibot";

import { configFileSchema, configSchema } from "./schema.js";

/** Parse declarative configuration; editor metadata never affects source pins.
 * @param text - Original config source.
 * @param comments - Whether JSONC syntax is allowed.
 * @returns Validated provider configuration without editor metadata.
 */
export const parseSourceConfig = (text: string, comments = true) => {
  const errors: ParseError[] = [];
  const input: unknown = parse(text, errors, {
    allowTrailingComma: comments,
    disallowComments: !comments,
  });
  if (errors.length) {
    throw new Error(
      `source/invalid-config: ${errors.map((error) => `${printParseErrorCode(error.error)} at ${error.offset}`).join(", ")}`
    );
  }
  const keys: Set<string>[] = [];
  visit(text, {
    onObjectBegin: () => {
      keys.push(new Set());
    },
    onObjectEnd: () => {
      keys.pop();
    },
    onObjectProperty: (name) => {
      const current = keys.at(-1);
      if (current?.has(name) === true) {
        throw new Error(`source/invalid-config: Duplicate property ${name}.`);
      }
      current?.add(name);
    },
  });
  const { $schema: _schema, ...data } = v.parse(configFileSchema, input);
  return v.parse(configSchema, data);
};

/** Load one unambiguous config, retaining compatibility with strict JSON.
 * @param root - Project directory URL.
 * @returns Validated source configuration.
 */
export const loadSourceConfig = async (root: URL) => {
  const files = ["chess.sources.json", "chess.sources.jsonc"].map((name) =>
    Bun.file(new URL(name, root))
  );
  const present = await Promise.all(
    files.map(async (file) => await file.exists())
  );
  if (present.every(Boolean)) {
    throw new Error(
      "source/ambiguous-config: Keep either chess.sources.json or chess.sources.jsonc."
    );
  }
  const index = present.findIndex(Boolean);
  return index === -1
    ? { providers: [], version: 1 as const }
    : parseSourceConfig(await files[index].text(), index === 1);
};

/** Apply a validated JSONC edit while retaining surrounding comments and syntax.
 * @param text - Original JSONC source.
 * @param path - Configuration property to change.
 * @param value - Replacement scalar value.
 * @returns Edited and revalidated configuration source.
 */
export const editSourceConfig = (
  text: string,
  path: (string | number)[],
  value: string | number | boolean | null
) => {
  parseSourceConfig(text);
  const result = applyEdits(
    text,
    modify(text, path, value, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    })
  );
  parseSourceConfig(result);
  return result;
};

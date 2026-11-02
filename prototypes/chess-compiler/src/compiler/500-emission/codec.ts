import { isDeepStrictEqual } from "node:util";

import {
  parseStructured,
  ok,
  err,
  type ReadonlyDeep,
  type DocumentData,
  type Result,
} from "../../contracts/index.js";
import { parseText } from "../100-parsing/index.js";
import { lower } from "../200-semantic-analysis/index.js";
import { digest } from "../identity.js";

/**
 * Parse flat source into its structured document model.
 * @param source - Chess narrative source text.
 * @returns The document or parsing and semantic diagnostics.
 */
export function decode(source: string): Result<DocumentData> {
  const parsed = parseText(source);
  return parsed.ok ? lower(parsed.value) : parsed;
}
/**
 * Pair structured data with its original source for exact restoration.
 * @param data - The structured representation of the source.
 * @param sourceText - Original text, including comments and whitespace.
 * @returns An envelope whose agreement is checked when restored.
 */
export function envelope(data: ReadonlyDeep<DocumentData>, sourceText: string) {
  return {
    format: "chess-source-envelope-prototype",
    version: 0,
    data,
    sourceText,
    digest: digest(sourceText),
  };
}
/**
 * Restore original text only when its digest and structured data agree.
 * @param input - An untrusted source envelope.
 * @returns Exact original text or an integrity diagnostic.
 */
export function restore(input: unknown): Result<string> {
  if (
    !input ||
    typeof input !== "object" ||
    Object.keys(input).some(
      (key) =>
        !["format", "version", "data", "sourceText", "digest"].includes(key)
    ) ||
    !("format" in input) ||
    input.format !== "chess-source-envelope-prototype" ||
    !("version" in input) ||
    input.version !== 0 ||
    !("sourceText" in input) ||
    typeof input.sourceText !== "string" ||
    !("digest" in input) ||
    digest(input.sourceText) !== input.digest ||
    !("data" in input)
  )
    return err(
      "integrity",
      "codec/invalid-envelope",
      "Unsupported or modified source envelope."
    );
  const data = parseStructured(input.data);
  if (!data.ok) return data;
  const parsed = decode(input.sourceText);
  if (!parsed.ok) return parsed;
  return isDeepStrictEqual(parsed.value, data.value)
    ? ok(input.sourceText)
    : err(
        "integrity",
        "codec/stale-source",
        "Source and structured data disagree."
      );
}
/**
 * Print validated structured data in canonical flat syntax.
 * @remarks This preserves the document model, but does not retain original formatting or comments.
 * @param input - An untrusted structured document.
 * @returns Canonical source text or validation diagnostics.
 */
export function printStructured(input: unknown): Result<string> {
  const checked = parseStructured(input);
  if (!checked.ok) return checked;
  const data = checked.value;
  const q = JSON.stringify;
  return ok(
    [
      `module ${data.name};`,
      ...data.imports.map((path) => `import ${q(path)};`),
      ...data.games.map(
        (g) =>
          `${g.exported ? "export " : ""}game ${g.name} from ${q(g.source)};`
      ),
      ...data.stories.map(
        (s) =>
          `story ${s.name} {\n${s.scenes
            .map(
              (scene) =>
                `  board ${scene.name} game ${scene.game} after ${scene.ply} {\n${scene.notes
                  .map(
                    (n) =>
                      `    ${n.type === "text" ? `text ${q(n.text)}` : n.type === "arrow" ? `arrow ${q(n.from)} -> ${q(n.to)} ${n.color}` : `prompt ${q(n.text)} answer ${q(n.answer)}`};`
                  )
                  .join("\n")}\n  }`
            )
            .join("\n")}\n}`
      ),
      "",
    ].join("\n")
  );
}

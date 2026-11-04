import * as v from "valibot";

import { printMarkdown } from "../../authoring/markdown.js";
import { parseStructured, ok, err } from "../../contracts/index.js";
import type {
  ReadonlyDeep,
  DocumentData,
  Result,
} from "../../contracts/index.js";
import { parseText } from "../100-parsing/index.js";
import { lower } from "../200-semantic-analysis/index.js";
import { digest } from "../identity.js";

/**
 * Parse flat source into its structured document model.
 * @param source - Chess narrative source text.
 * @returns The document or parsing and semantic diagnostics.
 */
export const decode = (source: string): Result<DocumentData> => {
  const parsed = parseText(source);
  return parsed.ok ? lower(parsed.value) : parsed;
};
/**
 * Pair structured data with its original source for exact restoration.
 * @param data - The structured representation of the source.
 * @param sourceText - Original text, including comments and whitespace.
 * @returns An envelope whose agreement is checked when restored.
 */
export const envelope = (
  data: ReadonlyDeep<DocumentData>,
  sourceText: string
) => ({
  data,
  digest: digest(sourceText),
  format: "chess-source-envelope-prototype",
  sourceText,
  version: 0,
});
/**
 * Restore original text only when its digest and structured data agree.
 * @param input - An untrusted source envelope.
 * @returns Exact original text or an integrity diagnostic.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is an external-data validation boundary; accepting unknown prevents callers from assuming validation already happened.
export const restore = (input: unknown): Result<string> => {
  const parsedEnvelope = v.safeParse(
    v.strictObject({
      data: v.unknown(),
      digest: v.string(),
      format: v.literal("chess-source-envelope-prototype"),
      sourceText: v.string(),
      version: v.literal(0),
    }),
    input
  );
  if (
    !parsedEnvelope.success ||
    digest(parsedEnvelope.output.sourceText) !== parsedEnvelope.output.digest
  ) {
    return err(
      "integrity",
      "codec/invalid-envelope",
      "Unsupported or modified source envelope."
    );
  }
  const accepted = parsedEnvelope.output;
  const data = parseStructured(accepted.data);
  if (!data.ok) {
    return data;
  }
  const parsed = decode(accepted.sourceText);
  if (!parsed.ok) {
    return parsed;
  }
  return Bun.deepEquals(parsed.value, data.value, true)
    ? ok(accepted.sourceText)
    : err(
        "integrity",
        "codec/stale-source",
        "Source and structured data disagree."
      );
};
/**
 * Print validated structured data in canonical flat syntax.
 * @remarks This preserves the document model, but does not retain original formatting or comments.
 * @param input - An untrusted structured document.
 * @returns Canonical source text or validation diagnostics.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is an external-data validation boundary; accepting unknown prevents callers from assuming validation already happened.
export const printStructured = (input: unknown): Result<string> => {
  const checked = parseStructured(input);
  if (!checked.ok) {
    return checked;
  }
  const data = checked.value;
  if (data.formatVersion === 1) {
    return printMarkdown(data);
  }
  const q = JSON.stringify;
  const noteText = (
    note: DocumentData["stories"][number]["scenes"][number]["notes"][number]
  ): string => {
    if (note.type === "text") {
      return `    text ${q(note.text)};`;
    }
    if (note.type === "arrow") {
      return `    arrow ${q(note.from)} -> ${q(note.to)} ${note.color};`;
    }
    if (note.type === "markdown") {
      throw new Error("Markdown notes require authoring version one.");
    }
    return `    prompt ${q(note.text)} answer ${q(note.answer)};`;
  };
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
                  .map(noteText)
                  .join("\n")}\n  }`
            )
            .join("\n")}\n}`
      ),
      "",
    ].join("\n")
  );
};

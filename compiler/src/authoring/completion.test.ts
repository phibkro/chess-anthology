/* oxlint-disable no-await-in-loop -- Each isolated editor session is checked independently. */
import { expect, test } from "bun:test";

import { URI } from "langium";

import { createServices } from "../compiler/300-linking/index.js";

const source = `---
id: completion
games:
  opera: ./opera.pgn
---

# Story
## Scene
@board opera after 30
@prompt Find the forcing move.
@answer 
`;
const uri = URI.parse("file:///completion/story.chess.md");
const pgn = await Bun.file(
  new URL("../../examples/opera.pgn", import.meta.url)
).text();

const complete = async (text: string, offset: number) => {
  const services = createServices(
    new Map([
      [uri.toString(), text],
      ["file:///completion/opera.pgn", pgn],
    ])
  );
  const document = services.shared.workspace.LangiumDocumentFactory.fromString(
    text,
    uri
  );
  services.shared.workspace.LangiumDocuments.addDocument(document);
  await services.shared.workspace.DocumentBuilder.build([document], {
    validation: true,
  });
  return await services.language.lsp.CompletionProvider.getCompletion(
    document,
    {
      position: document.textDocument.positionAt(offset),
      textDocument: { uri: uri.toString() },
    }
  );
};

test("Markdown frontmatter, bindings and legal SAN complete in source coordinates", async () => {
  const keys = await complete(source, source.indexOf("id:"));
  expect(keys?.items.some((item) => item.label === "games")).toBe(true);
  const board = source.replace("@board opera after 30", "@board ");
  const names = await complete(
    board,
    board.indexOf("@board ") + "@board ".length
  );
  expect(names?.items.some((item) => item.label === "opera")).toBe(true);
  const offset = source.indexOf("@answer ") + "@answer ".length;
  const answers = await complete(source, offset);
  const queen = answers?.items.find((item) => item.label === "Qb8+");
  expect(queen).toBeDefined();
  expect(queen?.textEdit).toEqual({
    newText: "Qb8+",
    range: {
      end: { character: 8, line: 10 },
      start: { character: 8, line: 10 },
    },
  });
});

test("Markdown completion leaves fenced and nested inline code alone", async () => {
  for (const literal of ["```\n@answer \n```", "*`line\n@answer \ncode`*"]) {
    const text = source.replace(
      "@prompt Find the forcing move.\n@answer ",
      literal
    );
    const offset = text.indexOf("@answer ") + "@answer ".length;
    const completed = await complete(text, offset);
    expect(completed?.items).toEqual([]);
  }
});

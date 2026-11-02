import { mkdir, writeFile } from "node:fs/promises";

import * as v from "valibot";

const source = "https://www.wfcc.ch/fide-albums/";
const response = await fetch(source, { signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error(`WFCC catalogue returned ${response.status}`);
const html = await response.text();
const text = (cell) =>
  cell
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&[a-z]+;/g, " ")
    .trim();
const records = [];
for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
  const cells = [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(
    (match) => text(match[1])
  );
  if (
    cells.length === 3 &&
    /^\d{4}\s*[-–]/.test(cells[0]) &&
    /^\d{4}$/.test(cells[1]) &&
    /^\d+$/.test(cells[2])
  )
    records.push({
      period: cells[0],
      published: Number(cells[1]),
      diagrams: Number(cells[2]),
    });
}
const schema = v.pipe(
  v.array(
    v.object({
      period: v.string(),
      published: v.number(),
      diagrams: v.number(),
    })
  ),
  v.minLength(20)
);
const albums = v.parse(schema, records);
await mkdir("content/catalog", { recursive: true });
await writeFile(
  "content/catalog/fide-albums.json",
  JSON.stringify(
    {
      source,
      retrieved: new Date().toISOString().slice(0, 10),
      scope:
        "Bibliographic catalogue only. Not the album contents or an open redistribution license.",
      albums,
    },
    null,
    2
  ) + "\n"
);
console.log(`Indexed ${albums.length} FIDE Album catalogue records.`);

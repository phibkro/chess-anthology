import * as v from "valibot";

const source = "https://www.wfcc.ch/fide-albums/";
const response = await fetch(source, { signal: AbortSignal.timeout(30_000) });
if (!response.ok) {
  throw new Error(`WFCC catalogue returned ${response.status}`);
}
const html = await response.text();
const text = (cell: string) =>
  cell
    .replaceAll(/<[^>]*>/gu, "")
    .replaceAll(/&nbsp;|&#160;/gu, " ")
    .replaceAll(/&[a-z]+;/gu, " ")
    .trim();
const records = [];
for (const row of html.matchAll(/<tr\b[^>]*>(?<capture1>[\s\S]*?)<\/tr>/giu)) {
  const cells = [
    ...row[1].matchAll(/<t[dh]\b[^>]*>(?<capture1>[\s\S]*?)<\/t[dh]>/giu),
  ].map((match) => text(match[1]));
  if (
    cells.length === 3 &&
    /^\d{4}\s*[-–]/u.test(cells[0]) &&
    /^\d{4}$/u.test(cells[1]) &&
    /^\d+$/u.test(cells[2])
  ) {
    records.push({
      diagrams: Number(cells[2]),
      period: cells[0],
      published: Number(cells[1]),
    });
  }
}
const schema = v.pipe(
  v.array(
    v.object({
      diagrams: v.number(),
      period: v.string(),
      published: v.number(),
    })
  ),
  v.minLength(20)
);
const albums = v.parse(schema, records);
await Bun.write(
  "content/catalog/fide-albums.json",
  `${JSON.stringify(
    {
      albums,
      retrieved: new Date().toISOString().slice(0, 10),
      scope:
        "Bibliographic catalogue only. Not the album contents or an open redistribution license.",
      source,
    },
    null,
    2
  )}\n`
);
console.log(`Indexed ${albums.length} FIDE Album catalogue records.`);

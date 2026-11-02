// PROTOTYPE directory adapter; only immediate .chess-story and .pgn files are loaded.
import { readdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "./compiler.js";
const directory = resolve(process.argv[2] ?? "examples");
const sources = new Map(
  await Promise.all(
    (await readdir(directory))
      .filter((name) => /\.(chess-story|pgn)$/.test(name))
      .map(
        async (name) =>
          [
            pathToFileURL(join(directory, name)).href,
            await readFile(join(directory, name), "utf8"),
          ] as const,
      ),
  ),
);
const { output } = await compile(sources);
console.log(JSON.stringify(output, null, 2));
process.exitCode = output.some((d) => d.diagnostics.some((issue) => issue.severity === 1)) ? 1 : 0;

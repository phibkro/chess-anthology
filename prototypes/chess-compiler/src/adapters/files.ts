import { readdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { ok, err, type Result } from "../document/index.js";
export async function loadDirectory(directory: string): Promise<Result<Map<string, string>>> {
  try {
    const root = resolve(directory);
    return ok(
      new Map(
        await Promise.all(
          (await readdir(root))
            .filter((name) => /\.(chess-story|pgn)$/.test(name))
            .map(
              async (name) =>
                [
                  pathToFileURL(join(root, name)).href,
                  await readFile(join(root, name), "utf8"),
                ] as const,
            ),
        ),
      ),
    );
  } catch (error) {
    return err("io", "source/read-failed", String(error));
  }
}

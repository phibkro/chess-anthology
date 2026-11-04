import { ok, err } from "../contracts/index.js";
import type { Result } from "../contracts/index.js";
import { readSourceText } from "../runtime/source-text.js";
/**
 * Acquire narrative and PGN files from one source directory using Bun.
 * @param directory - The directory to read.
 * @returns Acquired source text or an IO failure.
 */
export const loadDirectory = async (
  directory: string
): Promise<Result<Map<string, string>>> => {
  try {
    const root = Bun.pathToFileURL(
      directory.endsWith("/") ? directory : `${directory}/`
    );
    const files = [
      ...new Bun.Glob("*.{chess-story,chess.md,pgn}").scanSync({
        cwd: Bun.fileURLToPath(root),
        dot: true,
        onlyFiles: true,
      }),
    ];
    return ok(
      new Map(
        await Promise.all(
          files.map(async (name) => {
            const uri = Bun.pathToFileURL(Bun.fileURLToPath(root) + name);
            return [uri.href, await readSourceText(uri)] as const;
          })
        )
      )
    );
  } catch (error) {
    return err("io", "source/read-failed", String(error));
  }
};

import type { FileSystemProvider, FileSystemNode } from "langium";

import type { Sources } from "../contracts/index.js";
import { decodeSourceText } from "./source-text.js";

/**
 * Adapt Bun's asynchronous file APIs to Langium with explicit cached synchronous reads.
 * @param sources - Shared text cache used by validation callbacks.
 * @returns A filesystem whose synchronous methods only inspect already acquired content.
 */
export const createBunFileSystem = (sources: Sources): FileSystemProvider => {
  const metadata = new Map<string, FileSystemNode>();
  const directories = new Map<string, FileSystemNode[]>();
  const binaries = new Map<string, Uint8Array>();
  const stat: FileSystemProvider["stat"] = async (uri) => {
    const info = await Bun.file(Bun.fileURLToPath(uri.toString())).stat();
    const node = {
      isDirectory: info.isDirectory(),
      isFile: info.isFile(),
      uri,
    };
    metadata.set(uri.toString(), node);
    return node;
  };
  const readFile: FileSystemProvider["readFile"] = async (uri) => {
    const bytes = new Uint8Array(
      await Bun.file(Bun.fileURLToPath(uri.toString())).arrayBuffer()
    );
    const text = decodeSourceText(bytes);
    sources.set(uri.toString(), text);
    binaries.set(uri.toString(), bytes);
    return text;
  };
  return {
    exists: async (uri) => {
      try {
        const info = await stat(uri);
        return info.isFile || info.isDirectory;
      } catch {
        return false;
      }
    },
    existsSync: (uri) =>
      sources.has(uri.toString()) || metadata.has(uri.toString()),
    readBinary: async (uri) => {
      const bytes = new Uint8Array(
        await Bun.file(Bun.fileURLToPath(uri.toString())).arrayBuffer()
      );
      binaries.set(uri.toString(), bytes);
      return bytes;
    },
    readBinarySync: (uri) => {
      const bytes = binaries.get(uri.toString());
      if (!bytes) {
        throw new Error(
          "Acquire binary content asynchronously before synchronous access."
        );
      }
      return bytes;
    },
    readDirectory: async (uri) => {
      const root = Bun.fileURLToPath(uri.toString());
      const nodes = await Promise.all(
        [
          ...new Bun.Glob("*").scanSync({
            cwd: root,
            dot: true,
            onlyFiles: false,
          }),
        ].map(
          async (name) =>
            await stat(
              uri.with({ path: `${uri.path.replace(/\/$/u, "")}/${name}` })
            )
        )
      );
      directories.set(uri.toString(), nodes);
      return nodes;
    },
    readDirectorySync: (uri) => directories.get(uri.toString()) ?? [],
    readFile,
    readFileSync: (uri) => {
      const text = sources.get(uri.toString());
      if (text === undefined) {
        throw new Error(
          "Acquire source text asynchronously before synchronous access."
        );
      }
      return text;
    },
    stat,
    statSync: (uri) => {
      const node = metadata.get(uri.toString());
      if (!node) {
        throw new Error(
          "Acquire metadata asynchronously before synchronous access."
        );
      }
      return node;
    },
  };
};

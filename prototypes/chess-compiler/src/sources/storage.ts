// oxlint-disable-next-line import/no-nodejs-modules -- Bun has no direct atomic rename API; only persistence uses this compatibility primitive.
import { rename, unlink } from "node:fs/promises";

/**
 * Identify the exact bytes acquired from a source.
 * @param bytes - Unmodified source bytes.
 * @returns A SHA-256 blob identity.
 */
export const blobId = (bytes: Uint8Array): string =>
  `sha256:${new Bun.CryptoHasher("sha256").update(bytes).digest("hex")}`;

/**
 * Publish complete files atomically.
 * @param url - Destination file.
 * @param bytes - Complete file content.
 * @returns Completion after the atomic rename.
 */
export const writeAtomic = async (
  url: URL,
  bytes: string | Uint8Array
): Promise<void> => {
  const temporary = new URL(`${url.href}.${crypto.randomUUID()}.tmp`);
  try {
    await Bun.write(temporary, bytes);
    await rename(Bun.fileURLToPath(temporary), Bun.fileURLToPath(url));
  } finally {
    await unlink(Bun.fileURLToPath(temporary)).catch(() => {
      /* The temporary file has already been renamed on success. */
    });
  }
};

/**
 * Store immutable bytes, verifying their identity on every read.
 * @param directory - Blob directory with a trailing slash.
 * @returns Verified blob reads and immutable writes.
 */
export const createBlobStore = (directory: URL) => {
  const location = (id: string) => {
    if (!/^sha256:[a-f0-9]{64}$/u.test(id)) {
      throw new Error(
        "source/invalid-digest: Expected a SHA-256 blob identity."
      );
    }
    return new URL(`sha256/${id.slice(7)}`, directory);
  };
  const get = async (id: string): Promise<Uint8Array | undefined> => {
    const file = Bun.file(location(id));
    if (!(await file.exists())) {
      return undefined;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (blobId(bytes) !== id) {
      throw new Error(`source/corrupt-blob: ${id}`);
    }
    return bytes;
  };
  const put = async (bytes: Uint8Array): Promise<string> => {
    const id = blobId(bytes);
    if (!(await get(id))) {
      await writeAtomic(location(id), bytes);
    }
    return id;
  };
  return { get, put };
};

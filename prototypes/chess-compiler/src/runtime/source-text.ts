/**
 * Decode source bytes without stripping the leading Unicode BOM.
 * @param bytes - UTF-8 bytes acquired from a source artifact.
 * @returns Text with the same BOM treatment as the previous UTF-8 acquisition API.
 */
export const decodeSourceText = (bytes: ArrayBuffer | Uint8Array): string =>
  new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);

/**
 * Acquire a source artifact using Bun while preserving a leading BOM.
 * @param source - The file path or URI to read.
 * @returns Decoded source text; acquisition failures are handled by the calling adapter.
 */
export const readSourceText = async (source: string | URL): Promise<string> =>
  decodeSourceText(await Bun.file(source).arrayBuffer());

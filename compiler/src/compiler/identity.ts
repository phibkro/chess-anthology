/**
 * Compute the canonical SHA-256 identity of source text.
 * @param text - The source text to identify.
 * @returns A hexadecimal SHA-256 digest.
 */
export const digest = (text: string) =>
  new Bun.CryptoHasher("sha256").update(text).digest("hex");
const isObject = <T>(value: T): value is T & object =>
  value !== null && typeof value === "object";

/**
 * Recursively freeze the reachable values in a compiler-owned plain object graph.
 * @param value - A compiler-owned value to freeze.
 * @returns The same value after freezing its reachable object graph.
 */
export const freeze = <T>(value: T): T => {
  if (isObject(value) && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      freeze(child);
    }
    Object.freeze(value);
  }
  return value;
};

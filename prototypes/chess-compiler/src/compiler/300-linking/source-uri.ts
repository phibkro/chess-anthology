/**
 * Resolve a source reference against its containing module URI.
 * @param base - The containing source URI.
 * @param path - The referenced source path.
 * @returns Resolve a source reference against its containing module URI.
 */
export const relative = (base: string, path: string) => {
  // Invalid references remain unavailable values, rather than throwing during validation.
  try {
    return new URL(path, base).href;
  } catch {
    return `unresolved:${encodeURIComponent(path)}`;
  }
};

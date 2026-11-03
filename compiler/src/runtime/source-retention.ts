/**
 * Release orphaned game text and protect only current references and open buffers.
 * @param sources - Acquired source text owned by the editor adapter.
 * @param overlays - Authoritative open buffers.
 * @param references - Current source-reference policies keyed by canonical URI.
 * @param activate - Update the replay cache's active content set.
 * @returns Completion after source retirement and replay protection update.
 */
export const retainGameSources = (
  sources: Map<string, string>,
  overlays: ReadonlyMap<string, string>,
  references: ReadonlyMap<string, string>,
  activate: (texts: Iterable<string>) => void
): void => {
  const active: string[] = [];
  for (const [uri, text] of sources) {
    if (uri.endsWith(".chess-story")) {
      continue;
    }
    if (references.has(uri) || overlays.has(uri)) {
      active.push(text);
    } else {
      sources.delete(uri);
    }
  }
  activate(active);
};

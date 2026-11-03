/**
 * Keep editor overlays authoritative when asynchronous disk reads finish out of order.
 * @param sources - Acquired compiler source text.
 * @param overlays - Current unsaved editor buffers.
 * @param read - Asynchronous disk acquisition.
 * @returns An acquisition function that discards superseded results.
 */
export const createSourceCache = (
  sources: Map<string, string>,
  overlays: ReadonlyMap<string, string>,
  read: (uri: string) => Promise<string>
) => {
  const generations = new Map<string, symbol>();
  const pending = new Map<string, Promise<string | undefined>>();
  return async (uri: string): Promise<string | undefined> => {
    const task = (async (): Promise<string | undefined> => {
      const generation = Symbol("source-acquisition");
      generations.set(uri, generation);
      let acquired: string | undefined;
      try {
        acquired = overlays.get(uri) ?? (await read(uri));
      } catch {
        acquired = undefined;
      }
      if (generations.get(uri) !== generation) {
        const newer = pending.get(uri);
        return newer === undefined ? sources.get(uri) : await newer;
      }
      const text = overlays.get(uri) ?? acquired;
      if (text === undefined) {
        sources.delete(uri);
      } else {
        sources.set(uri, text);
      }
      return text;
    })();
    pending.set(uri, task);
    try {
      return await task;
    } finally {
      if (pending.get(uri) === task) {
        pending.delete(uri);
        generations.delete(uri);
      }
    }
  };
};

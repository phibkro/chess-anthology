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
  const generations = new Map<string, number>();
  const pending = new Map<string, Promise<string | undefined>>();
  return async (uri: string): Promise<string | undefined> => {
    const task = (async (): Promise<string | undefined> => {
      const generation = (generations.get(uri) ?? 0) + 1;
      generations.set(uri, generation);
      let acquired: string | undefined;
      try {
        acquired = overlays.get(uri) ?? (await read(uri));
      } catch {
        acquired = undefined;
      }
      if (generations.get(uri) !== generation) {
        return await pending.get(uri);
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
    return await task;
  };
};

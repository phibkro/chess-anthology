/* oxlint-disable no-await-in-loop -- Provider precedence requires ordered acquisition. */
import { makePgn, PgnParser } from "chessops/pgn";
import * as v from "valibot";

import { decodeSourceText } from "../runtime/source-text.js";
import { configSchema, lockSchema, resolutionSchema } from "./schema.js";
import type { Resolution, SourceConfig, SourceLock } from "./schema.js";
import { blobId, createBlobStore, writeAtomic } from "./storage.js";

const encode = (text: string) => new TextEncoder().encode(text);

/**
 * Select a game while preserving its original export separately.
 * @param bytes - Original export bytes.
 * @param selection - Optional one-based game ordinal.
 * @returns Original bytes or a canonical selected-game PGN.
 */
const selectGame = (bytes: Uint8Array, selection?: number): Uint8Array => {
  if (selection === undefined) {
    return bytes;
  }
  const games: string[] = [];
  const parser = new PgnParser((game, error) => {
    if (error) {
      throw new Error(`source/invalid-pgn: ${error.message}`);
    }
    games.push(makePgn(game));
  });
  parser.parse(decodeSourceText(bytes));
  const game = games[selection - 1];
  if (game === undefined) {
    throw new Error(
      `source/missing-selection: No game ${selection} in export.`
    );
  }
  return encode(game);
};

/**
 * Identify an unqualified record name eligible for provider fallback.
 * @param reference - Authored source reference.
 * @returns Whether configured providers may satisfy a missing relative file.
 */
export const isBareReference = (reference: string): boolean =>
  /^[^./:#][^/:#]*(?:#game=[1-9][0-9]*)?$/u.test(reference);

interface SourceRequest {
  url: URL;
  reference: string | undefined;
  selection: number | undefined;
  fragment: string;
  key: string;
}

/** Resolver controls supplied by a build or editor adapter. */
export interface ResolverOptions {
  root: URL;
  mode?: "locked" | "update" | "frozen";
  offline?: boolean;
  overlays?: ReadonlyMap<string, string>;
  fetch?: typeof globalThis.fetch;
}

/**
 * Open persistent source resolution state for one project.
 * @param options - Project root, acquisition policy and editor overlays.
 * @returns Source acquisition, blob storage and metadata publication operations.
 */
export const openResolver = async (options: ResolverOptions) => {
  const { root } = options;
  const mode = options.mode ?? "locked";
  const configFile = Bun.file(new URL("chess.sources.json", root));
  const config: SourceConfig = (await configFile.exists())
    ? v.parse(configSchema, await configFile.json())
    : { providers: [], version: 1 };
  if (
    new Set(config.providers.map((p) => p.id)).size !== config.providers.length
  ) {
    throw new Error("source/duplicate-provider: Provider IDs must be unique.");
  }
  for (const provider of config.providers) {
    if (provider.kind === "http") {
      const url = new URL(provider.url.replaceAll("{id}", "example"));
      if (
        !["http:", "https:"].includes(url.protocol) ||
        !provider.url.includes("{id}")
      ) {
        throw new Error(
          "source/invalid-provider: HTTP providers require an http(s) URL with {id}."
        );
      }
    }
  }
  const configDigest = blobId(encode(JSON.stringify(config)));
  const lockURL = new URL("chess.sources.lock.json", root);
  const lockFile = Bun.file(lockURL);
  const previous = (await lockFile.exists())
    ? v.parse(lockSchema, await lockFile.json())
    : undefined;
  if (previous && previous.config !== configDigest && mode !== "update") {
    throw new Error(
      "source/config-changed: Run with --update-sources to resolve the changed provider configuration."
    );
  }
  const lock: SourceLock = {
    config: configDigest,
    imports: previous?.config === configDigest ? { ...previous.imports } : {},
    version: 1,
  };
  const blobs = createBlobStore(new URL(".chess-cache/blobs/", root));
  const resolutions = new Map<string, Promise<Uint8Array>>();
  const catalog = new Map<string, Resolution>();
  const active = new Map<string, Resolution>();
  const changes: { request: string; before?: Resolution; after: Resolution }[] =
    [];
  const portable = (uri: string): string =>
    uri.startsWith(root.href) ? uri.slice(root.href.length) : uri;
  const load = async (url: URL): Promise<Uint8Array | undefined> => {
    if (url.protocol === "file:") {
      const overlay = options.overlays?.get(url.href);
      if (overlay !== undefined) {
        return encode(overlay);
      }
      const file = Bun.file(url);
      return (await file.exists())
        ? new Uint8Array(await file.arrayBuffer())
        : undefined;
    }
    if (options.offline === true) {
      throw new Error(`source/offline: No stored blob for ${url.href}.`);
    }
    const response = await (options.fetch ?? globalThis.fetch)(url, {
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 404) {
      return undefined;
    }
    if (!response.ok) {
      throw new Error(
        `source/fetch-failed: HTTP ${response.status} for ${url.href}.`
      );
    }
    return new Uint8Array(await response.arrayBuffer());
  };
  const recover = async (pinned: Resolution): Promise<Uint8Array> => {
    const hit = await blobs.get(pinned.blob);
    if (hit !== undefined) {
      return hit;
    }
    const bytes =
      (await blobs.get(pinned.original)) ??
      (await load(new URL(pinned.source, root)));
    if (bytes === undefined || blobId(bytes) !== pinned.original) {
      throw new Error(
        `source/locked-content-changed: Cannot recover ${pinned.original}; run --update-sources to accept a new version.`
      );
    }
    await blobs.put(bytes);
    const selected = selectGame(bytes, pinned.selection);
    if (blobId(selected) !== pinned.blob) {
      throw new Error(
        "source/selection-changed: Locked extraction differs from this selector implementation."
      );
    }
    await blobs.put(selected);
    return selected;
  };
  const discover = async (
    request: SourceRequest,
    pinned: Resolution | undefined
  ): Promise<Uint8Array> => {
    const { url, reference, selection, fragment, key } = request;
    const qualified = url.protocol === "chessdb:";
    const id = qualified
      ? decodeURIComponent(url.pathname.slice(1))
      : (reference?.split("#")[0] ?? "");
    const providers = qualified
      ? config.providers.filter((p) => p.id === url.hostname)
      : config.providers.toSorted(
          (a, b) => Number(a.kind === "http") - Number(b.kind === "http")
        );
    if (qualified && !providers.length) {
      throw new Error(`source/unknown-provider: ${url.hostname}`);
    }
    for (const provider of providers) {
      let source: URL;
      if (provider.kind === "directory") {
        const directory = new URL(
          provider.path.endsWith("/") ? provider.path : `${provider.path}/`,
          root
        );
        source = new URL(encodeURIComponent(id), directory);
        if (source.protocol !== "file:") {
          throw new Error(
            "source/invalid-provider: Directory providers require a local file path."
          );
        }
      } else {
        source = new URL(
          provider.url.replaceAll("{id}", encodeURIComponent(id))
        );
      }
      const catalogKey = `${configDigest}:${provider.id}:${id}${fragment}`;
      const catalogURL = new URL(
        `.chess-cache/catalog/${blobId(encode(catalogKey)).slice(7)}.json`,
        root
      );
      const cachedFile = Bun.file(catalogURL);
      if (
        provider.kind === "http" &&
        mode !== "update" &&
        (await cachedFile.exists())
      ) {
        const entry = v.parse(resolutionSchema, await cachedFile.json());
        const hit = await blobs.get(entry.blob);
        if (hit !== undefined) {
          lock.imports[key] = entry;
          active.set(key, entry);
          return hit;
        }
      }
      const bytes = await load(source);
      if (bytes === undefined) {
        continue;
      }
      const original = await blobs.put(bytes);
      const selected = selectGame(bytes, selection);
      const blob = await blobs.put(selected);
      const entry: Resolution = {
        blob,
        original,
        source: portable(source.href),
      };
      if (selection !== undefined) {
        entry.selection = selection;
      }
      lock.imports[key] = entry;
      active.set(key, entry);
      catalog.set(catalogKey, entry);
      if (!pinned || pinned.blob !== blob || pinned.source !== entry.source) {
        changes.push({ after: entry, before: pinned, request: key });
      }
      return selected;
    }
    throw new Error(`source/missing: No configured provider has ${id}.`);
  };
  const acquire = async (
    uri: string,
    reference?: string
  ): Promise<Uint8Array> => {
    const url = new URL(uri);
    const fragment = url.hash;
    const selection = fragment
      ? Number(
          /^#game=(?<ordinal>[1-9][0-9]*)$/u.exec(fragment)?.groups?.ordinal
        )
      : undefined;
    if (selection !== undefined && !Number.isSafeInteger(selection)) {
      throw new Error(
        "source/invalid-selection: Use #game=N with a positive safe integer."
      );
    }
    url.hash = "";
    const key = portable(uri);
    if (url.protocol === "sha256:") {
      const bytes = await blobs.get(uri);
      if (bytes === undefined) {
        throw new Error(`source/missing-blob: ${uri}`);
      }
      return bytes;
    }
    const qualified = url.protocol === "chessdb:";
    const bare = reference !== undefined && isBareReference(reference);
    // Explicit local files remain authoritative, including deletion and unsaved overlays.
    const local = url.protocol === "file:" ? await load(url) : undefined;
    if (local !== undefined) {
      const selected = selectGame(local, selection);
      if (selection !== undefined) {
        const original = await blobs.put(local);
        const blob = await blobs.put(selected);
        active.set(key, {
          blob,
          original,
          selection,
          source: portable(url.href),
        });
      }
      return selected;
    }
    if (!qualified && !bare) {
      throw new Error(`source/missing: ${uri}`);
    }
    const pinned =
      new Map(Object.entries(lock.imports)).get(key) ??
      new Map(Object.entries(previous?.imports ?? {})).get(key);
    if (pinned && mode !== "update") {
      lock.imports[key] = pinned;
      active.set(key, pinned);
      return await recover(pinned);
    }
    if (mode === "frozen") {
      throw new Error(`source/unlocked: ${key}`);
    }
    return await discover({ fragment, key, reference, selection, url }, pinned);
  };
  const read = async (uri: string, reference?: string): Promise<Uint8Array> => {
    const key = `${uri}\n${reference ?? ""}`;
    const existing = resolutions.get(key);
    if (existing) {
      return await existing;
    }
    const pending = acquire(uri, reference);
    resolutions.set(key, pending);
    try {
      return await pending;
    } finally {
      resolutions.delete(key);
    }
  };
  const publish = async (): Promise<void> => {
    const sorted = Object.fromEntries(
      Object.entries(lock.imports).toSorted(([a], [b]) => a.localeCompare(b))
    );
    if (mode !== "frozen") {
      await writeAtomic(
        lockURL,
        `${JSON.stringify({ ...lock, imports: sorted }, null, 2)}\n`
      );
      for (const [key, entry] of catalog) {
        await writeAtomic(
          new URL(
            `.chess-cache/catalog/${blobId(encode(key)).slice(7)}.json`,
            root
          ),
          `${JSON.stringify(entry, null, 2)}\n`
        );
      }
    }
  };
  let publication = Promise.resolve();
  const finish = async (): Promise<void> => {
    const previousPublication = publication;
    const released = Promise.withResolvers<undefined>();
    publication = released.promise;
    try {
      await previousPublication;
      await publish();
    } finally {
      released.resolve();
    }
  };
  return {
    blobs,
    changes,
    configured: config.providers.length > 0 || previous !== undefined,
    describe: () =>
      v.parse(lockSchema, {
        config: configDigest,
        imports: Object.fromEntries(
          [...active].toSorted(([a], [b]) => a.localeCompare(b))
        ),
        version: 1,
      }),
    finish,
    portable,
    read,
  };
};

import { parsePlaybackCollection } from "../../contracts/collection.js";
import type { PlaybackCollection } from "../../contracts/collection.js";
import { ok, err, narrativeDependencies } from "../../contracts/index.js";
import type {
  Result,
  BuildSnapshot,
  EmittedDocument,
} from "../../contracts/index.js";
import { parsePlaybackPlan } from "../../contracts/playback.js";
import type { PlaybackPlan } from "../../contracts/playback.js";
import { createCompositionLinker } from "../300-linking/index.js";
import type {
  CompositionDefinition,
  CompositionModule,
} from "../300-linking/index.js";
import { freeze } from "../identity.js";

const linkerFor = (snapshot: BuildSnapshot) =>
  createCompositionLinker(
    snapshot.output.flatMap((document): CompositionModule[] =>
      document.data ? [{ data: document.data, uri: document.uri }] : []
    )
  );

const validateImports = (
  snapshot: BuildSnapshot,
  entry: EmittedDocument
): Result<true> => {
  const pending = [entry];
  const visited = new Set<string>();
  while (pending.length) {
    const module = pending.pop();
    if (module === undefined) {
      break;
    }
    if (visited.has(module.uri)) {
      continue;
    }
    visited.add(module.uri);
    if (module.diagnostics.some((diagnostic) => diagnostic.severity === 1)) {
      return err(
        "schema",
        "plan/invalid-content",
        "Resolve source diagnostics before producing a playable story."
      );
    }
    for (const path of module.data ? narrativeDependencies(module.data) : []) {
      const dependency = snapshot.output.find(
        (document) => document.uri === new URL(path, module.uri).href
      );
      if (!dependency) {
        return err(
          "selection",
          "plan/missing-module",
          "An imported module is unavailable."
        );
      }
      pending.push(dependency);
    }
  }
  return ok(true);
};

const emitStory = (
  snapshot: BuildSnapshot,
  definition: Extract<CompositionDefinition, { kind: "story" }>,
  id: string
): Result<PlaybackPlan> => {
  const linked = linkerFor(snapshot).expandScenes(definition);
  if (!linked.ok) {
    return linked;
  }
  const scenes: unknown[] = [];
  const histories = new Map<
    string,
    {
      frames: readonly {
        fen: string;
        san: string | null;
        uci: string | null;
      }[];
    }
  >();
  for (const item of linked.value) {
    const { scene } = item;
    const entry = snapshot.output.find(
      (document) => document.uri === item.module.uri
    );
    const occurrence = entry?.occurrences.find(
      (value) => value.id === `${item.module.uri}#${item.story}/${scene.name}`
    );
    const game = snapshot.games.find(
      (value) => value.uri === occurrence?.sourceUri
    );
    if (!occurrence || game?.result.ok !== true) {
      return err(
        "selection",
        "plan/missing-game",
        "A board's game history is unavailable."
      );
    }
    const notes: unknown[] = [];
    let prompts = 0;
    for (const note of scene.notes) {
      if (note.type !== "prompt") {
        notes.push({ ...note });
        continue;
      }
      prompts += 1;
      const answer = occurrence.legalMoves.find(
        (move) => move.san === note.answer
      );
      if (
        !answer ||
        answer.uci !== game.result.value.frames[scene.ply + 1]?.uci ||
        prompts > 1
      ) {
        return err(
          "selection",
          "plan/unsupported-prompt",
          "This playback target requires one canonical SAN answer following the recorded line per board."
        );
      }
      notes.push({ ...note, answerUci: answer.uci });
    }
    histories.set(occurrence.sourceDigest, {
      frames: game.result.value.frames,
    });
    const emitted = {
      after: scene.ply,
      game: scene.game,
      historyId: occurrence.sourceDigest,
      id: item.id,
      notes,
      sourceDigest: occurrence.sourceDigest,
    };
    scenes.push(
      "title" in scene ? { ...emitted, title: scene.title } : emitted
    );
  }
  const common = {
    format: "chess-playback-plan",
    histories: Object.fromEntries(histories),
    id,
    scenes,
  };
  const { data } = definition.module;
  const plan =
    data.formatVersion === 0
      ? { ...common, version: 2 }
      : {
          ...common,
          metadata: data.metadata,
          title:
            "title" in definition.story
              ? definition.story.title
              : definition.story.name,
          version: 3,
        };
  const validated = parsePlaybackPlan(plan);
  return validated.ok ? ok(freeze(validated.value)) : validated;
};

/** Emit one local/imported story, including a story selected out of a collection.
 * @param snapshot - Immutable build revision.
 * @param entryUri - Selecting module's URI.
 * @param reference - Local name or collection/member selector.
 * @returns A portable story plan retaining original game scopes.
 */
export const createPlaybackPlan = (
  snapshot: BuildSnapshot,
  entryUri: string,
  reference: string
): Result<PlaybackPlan> => {
  const entry = snapshot.output.find((document) => document.uri === entryUri);
  if (
    !entry?.data ||
    (entry.data.formatVersion !== 2 &&
      !entry.data.stories.some((story) => story.name === reference))
  ) {
    return err("selection", "plan/missing-story", "Story is unavailable.");
  }
  const selected = linkerFor(snapshot).resolve(entryUri, reference);
  if (!selected.ok) {
    return selected;
  }
  if (selected.value.kind !== "story") {
    return err(
      "selection",
      "plan/expected-story",
      "Select a story or use createPlaybackCollection for a collection."
    );
  }
  const dependencies = validateImports(snapshot, entry);
  if (!dependencies.ok) {
    return dependencies;
  }
  return emitStory(
    snapshot,
    selected.value,
    `${entry.data?.name}/${reference}`
  );
};

/** Emit nested collection members as an ordered list of independently playable stories.
 * @param snapshot - Immutable build revision.
 * @param entryUri - Selecting module's URI.
 * @param reference - Local collection name or nested collection selector.
 * @returns A portable collection projection with stable occurrence paths.
 */
export const createPlaybackCollection = (
  snapshot: BuildSnapshot,
  entryUri: string,
  reference: string
): Result<PlaybackCollection> => {
  const entry = snapshot.output.find((document) => document.uri === entryUri);
  if (!entry) {
    return err(
      "selection",
      "plan/missing-module",
      "Collection module is unavailable."
    );
  }
  const linker = linkerFor(snapshot);
  const selected = linker.resolve(entryUri, reference);
  if (!selected.ok) {
    return selected;
  }
  if (selected.value.kind !== "collection") {
    return err(
      "selection",
      "plan/expected-collection",
      "Select a collection or use createPlaybackPlan for a story."
    );
  }
  const dependencies = validateImports(snapshot, entry);
  if (!dependencies.ok) {
    return dependencies;
  }
  const expanded = linker.expandStories(selected.value);
  if (!expanded.ok) {
    return expanded;
  }
  const id = `${entry.data?.name}/${reference}`;
  const stories: PlaybackCollection["stories"] = [];
  for (const story of expanded.value) {
    const plan = emitStory(snapshot, story.definition, `${id}/${story.id}`);
    if (!plan.ok) {
      return plan;
    }
    stories.push({ id: story.id, plan: plan.value });
  }
  const validated = parsePlaybackCollection({
    format: "chess-playback-collection",
    id,
    stories,
    title: selected.value.collection.name,
    version: 1,
  });
  return validated.ok ? ok(freeze(validated.value)) : validated;
};

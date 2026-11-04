import { ok, err } from "../../contracts/index.js";
import type {
  Result,
  BuildSnapshot,
  EmittedDocument,
} from "../../contracts/index.js";
import { parsePlaybackPlan } from "../../contracts/playback.js";
import type { PlaybackPlan } from "../../contracts/playback.js";
import { freeze } from "../identity.js";

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
    if (module.diagnostics.some((d) => d.severity === 1)) {
      return err(
        "schema",
        "plan/invalid-content",
        "Resolve source diagnostics before producing a playable story."
      );
    }
    for (const path of module.data?.imports ?? []) {
      const dependency = snapshot.output.find(
        (d) => d.uri === new URL(path, module.uri).href
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

const playbackVersion = (
  entry: EmittedDocument,
  storyName: string,
  common: { format: string; histories: object; id: string; scenes: unknown[] }
) => {
  if (entry.data?.formatVersion === 1) {
    return {
      ...common,
      metadata: entry.data.metadata,
      title: entry.data.stories.find((story) => story.name === storyName)
        ?.title,
      version: 3,
    };
  }
  return { ...common, version: 2 };
};

// This target supports a recorded mainline, with optional prompts and supplementary arrows.
/**
 * Emit a supported story plan while rejecting invalid or unsupported interactions.
 * @param snapshot - The immutable build revision to read.
 * @param entryUri - The narrative module containing the story.
 * @param storyName - The selected exported story name.
 * @returns A supported plan or an explicit capability failure.
 */
export const createPlaybackPlan = (
  snapshot: BuildSnapshot,
  entryUri: string,
  storyName: string
): Result<PlaybackPlan> => {
  const entry = snapshot.output.find((d) => d.uri === entryUri);
  const story = entry?.data?.stories.find((s) => s.name === storyName);
  if (!entry || !story) {
    return err("selection", "plan/missing-story", "Story is unavailable.");
  }
  const dependencies = validateImports(snapshot, entry);
  if (!dependencies.ok) {
    return dependencies;
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
  for (const scene of story.scenes) {
    const occurrence = entry.occurrences.find(
      (o) => o.id === `${entryUri}#${storyName}/${scene.name}`
    );
    const game = snapshot.games.find((g) => g.uri === occurrence?.sourceUri);
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
      id: scene.name,
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
    id: `${entry.data?.name}/${storyName}`,
    scenes,
  };
  const validated = parsePlaybackPlan(
    playbackVersion(entry, storyName, common)
  );
  return validated.ok ? ok(freeze(validated.value)) : validated;
};

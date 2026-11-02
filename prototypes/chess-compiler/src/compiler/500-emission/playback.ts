import { ok, err, type Result } from "../../document/index.js";
import {
  parsePlaybackPlan,
  type PlaybackPlan,
} from "../../document/playback.js";
import type { BuildSnapshot } from "../600-build/index.js";
import { freeze } from "../identity.js";
// This target supports a recorded mainline, with optional prompts and supplementary arrows.
export function createPlaybackPlan(
  snapshot: BuildSnapshot,
  entryUri: string,
  storyName: string
): Result<PlaybackPlan> {
  const entry = snapshot.output.find((d) => d.uri === entryUri);
  const story = entry?.data?.stories.find((s) => s.name === storyName);
  if (!entry || !story)
    return err("selection", "plan/missing-story", "Story is unavailable.");
  const pending = [entry];
  const visited = new Set<string>();
  while (pending.length) {
    const module = pending.pop()!;
    if (visited.has(module.uri)) continue;
    visited.add(module.uri);
    if (module.diagnostics.some((d) => d.severity === 1))
      return err(
        "schema",
        "plan/invalid-content",
        "Resolve source diagnostics before producing a playable story."
      );
    for (const path of module.data?.imports ?? []) {
      const dependency = snapshot.output.find(
        (d) => d.uri === new URL(path, module.uri).href
      );
      if (!dependency)
        return err(
          "selection",
          "plan/missing-module",
          "An imported module is unavailable."
        );
      pending.push(dependency);
    }
  }
  const scenes: unknown[] = [];
  for (const scene of story.scenes) {
    const occurrence = entry.occurrences.find(
      (o) => o.id === `${entryUri}#${storyName}/${scene.name}`
    );
    const game = snapshot.games.find((g) => g.uri === occurrence?.sourceUri);
    if (!occurrence || !game?.result.ok)
      return err(
        "selection",
        "plan/missing-game",
        "A board's game history is unavailable."
      );
    const notes: unknown[] = [];
    let prompts = 0;
    for (const note of scene.notes) {
      if (note.type !== "prompt") {
        notes.push({ ...note });
        continue;
      }
      prompts++;
      const answer = occurrence.legalMoves.find(
        (move) => move.san === note.answer
      );
      if (
        !answer ||
        answer.uci !== game.result.value.frames[scene.ply + 1]?.uci ||
        prompts > 1
      )
        return err(
          "selection",
          "plan/unsupported-prompt",
          "This playback target requires one canonical SAN answer following the recorded line per board."
        );
      notes.push({ ...note, answerUci: answer.uci });
    }
    scenes.push({
      id: scene.name,
      game: scene.game,
      after: scene.ply,
      sourceDigest: occurrence.sourceDigest,
      frames: game.result.value.frames.map((f) => ({ ...f })),
      notes,
    });
  }
  const validated = parsePlaybackPlan({
    format: "chess-playback-plan",
    version: 1,
    id: `${entry.data?.name}/${storyName}`,
    scenes,
  });
  return validated.ok ? ok(freeze(validated.value)) : validated;
}

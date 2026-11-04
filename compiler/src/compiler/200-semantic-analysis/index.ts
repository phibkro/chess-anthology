import { parseStructured } from "../../contracts/index.js";
import type {
  Issue,
  Result,
  DocumentData,
  SceneData,
} from "../../contracts/index.js";
import {
  markdownAuthoring,
  markdownScene,
  isGame,
  isStory,
  isText,
  isArrow,
} from "../100-parsing/index.js";
import type { Module, Scene } from "../100-parsing/index.js";
/**
 * Lower a syntax occurrence into plain authored scene data.
 * @param scene - The authored board occurrence.
 * @returns Lower a syntax occurrence into plain authored scene data.
 */
export const lowerScene = (scene: Scene): SceneData =>
  markdownScene(scene) ?? {
    game: scene.game.$refText,
    name: scene.name,
    notes: scene.notes.map((note) => {
      if (isText(note)) {
        return { text: note.text, type: "text" };
      }
      if (isArrow(note)) {
        return {
          color: note.color,
          from: note.from,
          to: note.to,
          type: "arrow",
        };
      }
      return { answer: note.answer, text: note.text, type: "prompt" };
    }),
    ply: scene.ply,
  };
/**
 * Lower syntax declarations into a structurally validated authored document.
 * @param module - The parsed narrative syntax root.
 * @returns Authored data or structural validation errors.
 */
export const lower = (module: Module): Result<DocumentData> => {
  const markdown = markdownAuthoring(module);
  if (markdown) {
    return markdown.ok ? { ok: true, value: markdown.value.data } : markdown;
  }
  return parseStructured({
    formatVersion: 0,
    games: module.declarations
      .filter(isGame)
      .map((g) => ({ exported: g.exported, name: g.name, source: g.path })),
    imports: module.imports.map((i) => i.path),
    name: module.name,
    stories: module.declarations
      .filter(isStory)
      .map((s) => ({ name: s.name, scenes: s.scenes.map(lowerScene) })),
  });
};

/**
 * Check local declaration and occurrence identities without linking games.
 * @param data - Structurally validated authored values.
 * @returns Check local declaration and occurrence identities without linking games.
 */
export const analyzeLocal = (data: DocumentData): Issue[] => {
  const issues: Issue[] = [];
  const names = new Set<string>();
  for (const [kind, declarations] of [
    ["games", data.games],
    ["stories", data.stories],
  ] as const) {
    for (const [i, declaration] of declarations.entries()) {
      if (names.has(declaration.name)) {
        issues.push({
          code: "semantic/duplicate-symbol",
          message: `Duplicate declaration ${declaration.name}.`,
          path: [kind, i, "name"],
        });
      }
      names.add(declaration.name);
    }
  }
  for (const [i, story] of data.stories.entries()) {
    const scenes = new Set<string>();
    for (const [j, scene] of story.scenes.entries()) {
      if (scenes.has(scene.name)) {
        issues.push({
          code: "semantic/duplicate-occurrence",
          message: `Duplicate board occurrence ${scene.name}.`,
          path: ["stories", i, "scenes", j, "name"],
        });
      }
      scenes.add(scene.name);
    }
  }
  return issues;
};

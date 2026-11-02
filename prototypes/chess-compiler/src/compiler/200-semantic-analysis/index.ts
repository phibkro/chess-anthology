import {
  parseStructured,
  type Issue,
  type Result,
  type DocumentData,
  type SceneData,
} from "../../document/index.js";
import {
  isGame,
  isStory,
  isText,
  isArrow,
  type Module,
  type Scene,
} from "../100-parsing/index.js";
export function lowerScene(scene: Scene): SceneData {
  return {
    name: scene.name,
    game: scene.game.$refText,
    ply: scene.ply,
    notes: scene.notes.map((note) =>
      isText(note)
        ? { type: "text", text: note.text }
        : isArrow(note)
          ? { type: "arrow", from: note.from, to: note.to, color: note.color }
          : { type: "prompt", text: note.text, answer: note.answer }
    ),
  };
}
export function lower(module: Module): Result<DocumentData> {
  return parseStructured({
    formatVersion: 0,
    name: module.name,
    imports: module.imports.map((i) => i.path),
    games: module.declarations
      .filter(isGame)
      .map((g) => ({ name: g.name, exported: g.exported, source: g.path })),
    stories: module.declarations
      .filter(isStory)
      .map((s) => ({ name: s.name, scenes: s.scenes.map(lowerScene) })),
  });
}

export function analyzeLocal(data: DocumentData): Issue[] {
  const issues: Issue[] = [];
  const names = new Set<string>();
  for (const [kind, declarations] of [
    ["games", data.games],
    ["stories", data.stories],
  ] as const) {
    declarations.forEach((declaration, i) => {
      if (names.has(declaration.name))
        issues.push({
          code: "semantic/duplicate-symbol",
          message: `Duplicate declaration ${declaration.name}.`,
          path: [kind, i, "name"],
        });
      names.add(declaration.name);
    });
  }
  data.stories.forEach((story, i) => {
    const scenes = new Set<string>();
    story.scenes.forEach((scene, j) => {
      if (scenes.has(scene.name))
        issues.push({
          code: "semantic/duplicate-occurrence",
          message: `Duplicate board occurrence ${scene.name}.`,
          path: ["stories", i, "scenes", j, "name"],
        });
      scenes.add(scene.name);
    });
  });
  return issues;
}

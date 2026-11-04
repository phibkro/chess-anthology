/* oxlint-disable no-use-before-define -- Selection and descent are mutually recursive; execution starts after both closures are constructed. */
import { err, ok } from "../../contracts/index.js";
import type {
  DocumentData,
  SceneData,
  ReadonlyDeep,
  Result,
  Issue,
} from "../../contracts/index.js";

/** A module's authored definitions remain owned by their original source. */
export interface CompositionModule {
  uri: string;
  data: ReadonlyDeep<DocumentData>;
}
type Story = ReadonlyDeep<DocumentData["stories"][number]>;
type Collection = ReadonlyDeep<
  Extract<DocumentData, { formatVersion: 2 }>["collections"][number]
>;
/** Resolved identity, separate from each use's occurrence path. */
export type CompositionDefinition =
  | { kind: "story"; module: CompositionModule; story: Story; key: string }
  | {
      kind: "collection";
      module: CompositionModule;
      collection: Collection;
      key: string;
    };
/** One board use with stable instance identity and original binding scope. */
interface ComposedScene {
  id: string;
  module: CompositionModule;
  story: string;
  scene: ReadonlyDeep<SceneData>;
}
/** A story selected from a possibly nested collection. */
interface ComposedStory {
  id: string;
  definition: Extract<CompositionDefinition, { kind: "story" }>;
}

class CompositionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CompositionError";
    this.code = code;
  }
}
const fail = (code: string, message: string): never => {
  throw new CompositionError(`link/${code}`, message);
};
const attempt = <T>(operation: () => T): Result<T> => {
  try {
    return ok(operation());
  } catch (error) {
    return error instanceof CompositionError
      ? err("selection", error.code, error.message)
      : err("infrastructure", "composition/failure", String(error));
  }
};
const segments = (reference: string): string[] => {
  if (
    !/^[_a-zA-Z][_a-zA-Z0-9-]*(?:\/[_a-zA-Z][_a-zA-Z0-9-]*)*$/u.test(reference)
  ) {
    fail(
      "invalid-selection",
      `Invalid story/collection selector ${reference}.`
    );
  }
  return reference.split("/");
};

const enter = (key: string, stack: readonly string[]) => {
  if (stack.includes(key)) {
    fail(
      "composition-cycle",
      `Composition cycle: ${[...stack, key].join(" -> ")}`
    );
  }
  return [...stack, key];
};

/** Link named story/collection references without copying or rebinding their data.
 * @param modules - Available authored modules in the current revision.
 * @returns Selection, expansion and validation operations over this revision.
 */
export const createCompositionLinker = (
  modules: Iterable<CompositionModule>
) => {
  const documents = new Map([...modules].map((module) => [module.uri, module]));
  const moduleAt = (uri: string) =>
    documents.get(uri) ?? fail("missing-module", `Unavailable module ${uri}.`);
  const external = (
    owner: CompositionModule,
    source: string,
    stack: readonly string[]
  ): CompositionDefinition => {
    const index = source.indexOf("#");
    if (index <= 0) {
      fail(
        "invalid-selection",
        "Named story imports require MODULE#EXPORT[/MEMBER]."
      );
    }
    const uri = new URL(source.slice(0, index), owner.uri).href;
    const selector = source.slice(index + 1);
    const names = segments(selector);
    const target = moduleAt(uri);
    if (
      target.data.formatVersion !== 2 ||
      !target.data.exports.includes(names[0])
    ) {
      fail("not-exported", `${names[0]} is not exported by ${uri}.`);
    }
    return select(target, names, stack);
  };
  const select = (
    module: CompositionModule,
    names: string[],
    stack: readonly string[]
  ): CompositionDefinition => {
    const [name, ...tail] = names;
    const story = module.data.stories.find((item) => item.name === name);
    const { data } = module;
    const collection =
      data.formatVersion === 2
        ? data.collections.find((item) => item.name === name)
        : undefined;
    const binding =
      data.formatVersion === 2
        ? data.uses.find((item) => item.name === name)
        : undefined;
    let definition: CompositionDefinition;
    if (story) {
      definition = {
        key: `${module.uri}#${story.name}`,
        kind: "story",
        module,
        story,
      };
    } else if (collection) {
      definition = {
        collection,
        key: `${module.uri}#${collection.name}`,
        kind: "collection",
        module,
      };
    } else if (binding) {
      definition = external(
        module,
        binding.source,
        enter(`${module.uri}#use:${name}`, stack)
      );
    } else {
      return fail(
        "missing-composition",
        `No story or collection ${name} in ${module.uri}.`
      );
    }
    return descend(definition, tail, stack);
  };
  const descend = (
    definition: CompositionDefinition,
    names: string[],
    stack: readonly string[]
  ): CompositionDefinition => {
    if (names.length === 0) {
      return definition;
    }
    if (definition.kind !== "collection") {
      return fail(
        "not-a-collection",
        `${definition.key} has no collection members.`
      );
    }
    const [name, ...rest] = names;
    const member = definition.collection.members.find(
      (item) => item.name === name
    );
    if (!member) {
      return fail("missing-member", `No member ${name} in ${definition.key}.`);
    }
    const next = enter(`${definition.key}/${name}`, stack);
    return descend(
      select(definition.module, segments(member.reference), next),
      rest,
      next
    );
  };
  const scenes = (
    definition: CompositionDefinition,
    path: string[],
    stack: readonly string[]
  ): ComposedScene[] => {
    const next = enter(definition.key, stack);
    if (definition.kind === "collection") {
      return definition.collection.members.flatMap((member) =>
        scenes(
          select(definition.module, segments(member.reference), []),
          [...path, member.name],
          next
        )
      );
    }
    return definition.story.scenes.flatMap((scene) =>
      "type" in scene
        ? scenes(
            select(definition.module, segments(scene.reference), []),
            [...path, scene.name],
            next
          )
        : [
            {
              id: [...path, scene.name].join("/"),
              module: definition.module,
              scene,
              story: definition.story.name,
            },
          ]
    );
  };
  const stories = (
    definition: CompositionDefinition,
    path: string[],
    stack: readonly string[]
  ): ComposedStory[] => {
    const next = enter(definition.key, stack);
    if (definition.kind === "story") {
      return [{ definition, id: path.join("/") }];
    }
    return definition.collection.members.flatMap((member) =>
      stories(
        select(definition.module, segments(member.reference), []),
        [...path, member.name],
        next
      )
    );
  };
  const resolve = (uri: string, reference: string) =>
    attempt(() => select(moduleAt(uri), segments(reference), []));
  const expandScenes = (definition: CompositionDefinition) =>
    attempt(() => scenes(definition, [], []));
  const expandStories = (definition: CompositionDefinition) =>
    attempt(() => stories(definition, [], []));
  let inspectedDefinitions = 0;
  const inspect = (
    definition: CompositionDefinition,
    stack: readonly string[],
    visited: Set<string>
  ): void => {
    if (visited.has(definition.key)) {
      return;
    }
    const next = enter(definition.key, stack);
    inspectedDefinitions += 1;
    const references =
      definition.kind === "collection"
        ? definition.collection.members.map((member) => member.reference)
        : definition.story.scenes.flatMap((scene) =>
            "type" in scene ? [scene.reference] : []
          );
    for (const reference of references) {
      inspect(
        select(definition.module, segments(reference), []),
        next,
        visited
      );
    }
    visited.add(definition.key);
  };
  const validate = (uri: string): Issue[] => {
    const module = moduleAt(uri);
    const { data } = module;
    if (data.formatVersion !== 2) {
      return [];
    }
    const issues: Issue[] = [];
    const visited = new Set<string>();
    inspectedDefinitions = 0;
    const check = (
      reference: string,
      path: (string | number)[],
      expand: boolean
    ) => {
      const result = resolve(uri, reference);
      const checked =
        result.ok && expand
          ? attempt(() => {
              inspect(result.value, [], visited);
            })
          : result;
      if (!checked.ok) {
        issues.push({
          code: checked.error.code,
          message: checked.error.message,
          path,
        });
      }
    };
    for (const [index, binding] of data.uses.entries()) {
      check(binding.name, ["uses", index], false);
    }
    for (const [index, name] of data.exports.entries()) {
      if (!data.games.some((game) => game.name === name)) {
        check(name, ["exports", index], false);
      }
    }
    for (const [index, story] of data.stories.entries()) {
      check(story.name, ["stories", index], true);
    }
    for (const [index, collection] of data.collections.entries()) {
      const names = new Set<string>();
      for (const [memberIndex, member] of collection.members.entries()) {
        if (names.has(member.name)) {
          issues.push({
            code: "semantic/duplicate-member",
            message: `Duplicate member ${member.name} in ${collection.name}; give each use a distinct alias.`,
            path: ["collections", index, "members", memberIndex],
          });
        }
        names.add(member.name);
      }
      check(collection.name, ["collections", index], true);
    }
    return issues;
  };
  return {
    expandScenes,
    expandStories,
    resolve,
    validate,
    validationWork: () => inspectedDefinitions,
  };
};

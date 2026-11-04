import type { Heading, Paragraph, RootContent, Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import * as v from "valibot";

import {
  authoringSchema,
  compositionSchema,
  Identifier,
  reservedIdentifiers,
} from "../contracts/authored.js";
import type {
  MarkdownData,
  CompositionData,
  SceneData,
} from "../contracts/authored.js";
import { err, ok } from "../contracts/core.js";
import type { Result } from "../contracts/core.js";
import { markdownData } from "../contracts/markdown.js";
import { readFrontmatter } from "./frontmatter.js";

/** UTF-16 source offsets, with an exclusive end. */
export interface Span {
  start: number;
  end: number;
}
/** Source associations accompany, rather than modify, the authoring AST. */
export interface MarkdownSyntax {
  data: MarkdownData;
  spans: Map<object, Span>;
  frontmatter: Span;
  boards: Map<string, Span>;
}
type Story = CompositionData["stories"][number];
type Scene = Extract<SceneData, { title: string }>;

const slug = (title: string) => {
  const normalized = title
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036F]/gu, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9_]+/gu, "-")
    .replaceAll(/^-|-$/gu, "");
  const name = /^[a-z_]/u.test(normalized)
    ? normalized
    : `section-${normalized}`;
  return reservedIdentifiers.some((keyword) => keyword === name)
    ? `section-${name}`
    : name;
};
const titleOf = (node: Heading) => {
  if (node.children.some((child) => child.type !== "text")) {
    throw new Error(
      "Story and scene headings require plain text; use rich Markdown in scene prose."
    );
  }
  return node.children
    .map((child) => (child.type === "text" ? child.value : ""))
    .join("");
};
const sourceSpan = (node: RootContent, base: number): Span => ({
  end: base + (node.position?.end.offset ?? 0),
  start: base + (node.position?.start.offset ?? 0),
});

const inlineCodeSpans = (node: Nodes, base: number): Span[] => {
  if (node.type === "inlineCode") {
    return [
      {
        end: base + (node.position?.end.offset ?? 0),
        start: base + (node.position?.start.offset ?? 0),
      },
    ];
  }
  return "children" in node
    ? node.children.flatMap((child) => inlineCodeSpans(child, base))
    : [];
};

class MarkdownReader {
  private readonly source: string;
  private readonly header: ReturnType<typeof readFrontmatter>;
  private readonly data: CompositionData;
  private readonly spans = new Map<object, Span>();
  private readonly boards = new Map<string, Span>();
  private story: Story | undefined;
  private scene: Scene | undefined;
  private hasBoard = false;
  private pendingPrompt: { text: string; span: Span } | undefined;
  private rich: RootContent[] = [];
  private richSpan: Span | undefined;
  private canId = false;

  constructor(source: string) {
    this.source = source;
    this.header = readFrontmatter(source);
    const {
      id,
      games = {},
      imports = [],
      exports = [],
      uses = {},
      collections = {},
      ...metadata
    } = this.header.data;
    this.data = {
      collections: Object.entries(collections).map(([name, members]) => ({
        members: members.map((member) =>
          v.is(v.string(), member)
            ? { name: member.split("/").at(-1) ?? member, reference: member }
            : { name: member.as, reference: member.use }
        ),
        name,
      })),
      exports,
      formatVersion: 2,
      games: Object.entries(games).map(([name, reference]) => ({
        exported: exports.includes(name),
        name,
        source: reference,
      })),
      imports,
      metadata,
      name: id,
      stories: [],
      uses: Object.entries(uses).map(([name, reference]) => ({
        name,
        source: reference,
      })),
    };
    this.spans.set(this.data, { end: this.header.body, start: 0 });
    for (const game of this.data.games) {
      this.spans.set(game, { end: this.header.end, start: this.header.start });
    }
  }
  private flush() {
    if (this.rich.length === 0) {
      return;
    }
    if (!this.scene) {
      throw new Error("Place narrative prose inside a scene (## heading).");
    }
    const note = {
      content: markdownData({ children: this.rich, type: "root" }),
      type: "markdown" as const,
    };
    this.scene.notes.push(note);
    if (this.richSpan) {
      this.spans.set(note, this.richSpan);
    }
    this.rich = [];
    this.richSpan = undefined;
  }
  private finishScene() {
    this.flush();
    if (this.pendingPrompt) {
      throw new Error("@prompt requires a following @answer.");
    }
    if (this.scene && !this.hasBoard) {
      throw new Error(`Scene ${this.scene.name} requires one @board.`);
    }
  }
  private addProse(node: RootContent, span: Span) {
    if (this.pendingPrompt) {
      throw new Error("Keep @prompt and @answer adjacent.");
    }
    this.canId = false;
    this.rich.push(node);
    this.richSpan = {
      end: span.end,
      start: this.richSpan?.start ?? span.start,
    };
  }
  private addNote(note: Scene["notes"][number], span: Span) {
    if (!this.scene) {
      throw new Error("Chess annotations require a scene.");
    }
    this.scene.notes.push(note);
    this.spans.set(note, span);
  }
  private board(argument: string, span: Span) {
    if (!this.scene || !this.story) {
      throw new Error("@board requires a scene.");
    }
    if (this.hasBoard) {
      throw new Error("A scene supports exactly one @board.");
    }
    const board =
      /^(?<game>[_a-zA-Z][_a-zA-Z0-9-]*)[ \t]+after[ \t]+(?<ply>[0-9]+)$/u.exec(
        argument
      );
    if (!board?.groups) {
      throw new Error("Use @board GAME after PLY.");
    }
    this.scene.game = board.groups.game;
    this.scene.ply = Number(board.groups.ply);
    this.hasBoard = true;
    this.boards.set(`${this.story.name}/${this.scene.name}`, span);
    this.spans.set(this.scene, span);
  }
  private arrow(argument: string, span: Span) {
    const arrow =
      /^(?<from>[a-h][1-8])[ \t]+->[ \t]+(?<to>[a-h][1-8])[ \t]+(?<color>green|red|blue|yellow)$/u.exec(
        argument
      );
    if (!arrow?.groups) {
      throw new Error(
        "Use @arrow FROM -> TO COLOR (green, red, blue or yellow)."
      );
    }
    this.addNote(
      {
        color: arrow.groups.color,
        from: arrow.groups.from,
        to: arrow.groups.to,
        type: "arrow",
      },
      span
    );
  }
  private prompt(argument: string, span: Span) {
    if (argument === "") {
      throw new Error("@prompt requires question text.");
    }
    this.pendingPrompt = { span, text: argument };
  }
  private answer(argument: string, span: Span) {
    if (!this.pendingPrompt || argument === "") {
      throw new Error("@answer requires a preceding @prompt and a SAN move.");
    }
    this.addNote(
      { answer: argument, text: this.pendingPrompt.text, type: "prompt" },
      { end: span.end, start: this.pendingPrompt.span.start }
    );
    this.pendingPrompt = undefined;
  }
  private include(argument: string, span: Span) {
    this.finishScene();
    if (!this.story) {
      throw new Error("@include requires a story heading.");
    }
    const match =
      /^(?<reference>[_a-zA-Z][_a-zA-Z0-9/-]*)(?:[ \t]+as[ \t]+(?<alias>[_a-zA-Z][_a-zA-Z0-9-]*))?$/u.exec(
        argument
      );
    if (!match?.groups) {
      throw new Error("Use @include REFERENCE [as OCCURRENCE].");
    }
    const { reference } = match.groups;
    const name = match.groups.alias ?? reference.split("/").at(-1) ?? reference;
    const include = { name, reference, type: "include" as const };
    this.story.scenes.push(include);
    this.spans.set(include, span);
    this.scene = undefined;
    this.hasBoard = false;
  }
  private directive(line: string, span: Span) {
    const match = /^@(?<name>[a-zA-Z][\w-]*)(?:[ \t]+(?<argument>.*))?$/u.exec(
      line
    );
    if (!match?.groups) {
      throw new Error(`Invalid directive: ${line}`);
    }
    const { name, argument = "" } = match.groups;
    if (this.pendingPrompt && name !== "answer") {
      throw new Error("@prompt requires an adjacent @answer.");
    }
    this.flush();
    if (name === "id") {
      if (!this.canId || !this.story) {
        throw new Error(
          "@id must immediately follow a story or scene heading."
        );
      }
      (this.scene ?? this.story).name = v.parse(Identifier, argument);
      this.canId = false;
      return;
    }
    this.canId = false;
    if (name === "include") {
      this.include(argument, span);
      return;
    }
    if (!this.scene) {
      throw new Error(`@${name} requires a scene.`);
    }
    switch (name) {
      case "board": {
        this.board(argument, span);
        break;
      }
      case "arrow": {
        this.arrow(argument, span);
        break;
      }
      case "prompt": {
        this.prompt(argument, span);
        break;
      }
      case "answer": {
        this.answer(argument, span);
        break;
      }
      case "text": {
        const text: unknown = JSON.parse(argument);
        this.addNote({ text: v.parse(v.string(), text), type: "text" }, span);
        break;
      }
      default: {
        throw new Error(
          `Unknown directive @${name}. Escape a literal line with \\@.`
        );
      }
    }
  }
  private heading(node: Heading, span: Span) {
    this.finishScene();
    const title = titleOf(node);
    if (node.depth === 1) {
      this.story = { name: slug(title), scenes: [], title };
      this.data.stories.push(this.story);
      this.scene = undefined;
      this.spans.set(this.story, span);
    } else {
      if (!this.story) {
        throw new Error("A scene requires a preceding story (# heading).");
      }
      this.scene = { game: "", name: slug(title), notes: [], ply: 0, title };
      this.story.scenes.push(this.scene);
      this.spans.set(this.scene, span);
    }
    this.hasBoard = false;
    this.canId = true;
  }
  private paragraph(node: Paragraph, span: Span) {
    const raw = this.source.slice(span.start, span.end);
    const code = inlineCodeSpans(node, this.header.body);
    let cursor = span.start;
    let prose = "";
    let proseStart = cursor;
    const flushProse = () => {
      for (const part of fromMarkdown(prose).children) {
        this.addProse(part, sourceSpan(part, proseStart));
      }
      prose = "";
    };
    for (const line of raw.split(/\r?\n/u)) {
      const next =
        cursor +
        line.length +
        (this.source[cursor + line.length] === "\r" ? 2 : 1);
      const lineOffset = cursor;
      if (
        /^@[a-zA-Z]/u.test(line) &&
        !code.some(
          (range) => range.start <= lineOffset && range.end > lineOffset
        )
      ) {
        flushProse();
        this.directive(line, { end: cursor + line.length, start: cursor });
        proseStart = next;
      } else {
        prose += `${line}\n`;
      }
      cursor = next;
    }
    flushProse();
  }
  read(): MarkdownSyntax {
    for (const node of fromMarkdown(this.source.slice(this.header.body))
      .children) {
      const span = sourceSpan(node, this.header.body);
      if (node.type === "heading" && node.depth <= 2) {
        this.heading(node, span);
      } else if (node.type === "definition") {
        throw new Error(
          "Use inline Markdown links; reference definitions are not yet supported."
        );
      } else if (node.type === "paragraph") {
        this.paragraph(node, span);
      } else {
        this.addProse(node, span);
      }
    }
    this.finishScene();
    v.parse(compositionSchema, this.data);
    const modern =
      this.data.uses.length > 0 ||
      this.data.collections.length > 0 ||
      this.data.exports.some(
        (name) => !this.data.games.some((game) => game.name === name)
      ) ||
      this.data.stories.some((story) =>
        story.scenes.some((scene) => "type" in scene)
      );
    let data: MarkdownData = this.data;
    if (!modern) {
      const stories = this.data.stories.map((story) => {
        const projected = {
          ...story,
          scenes: story.scenes.flatMap((scene) =>
            "type" in scene ? [] : [scene]
          ),
        };
        const span = this.spans.get(story);
        if (span) {
          this.spans.set(projected, span);
        }
        return projected;
      });
      data = {
        formatVersion: 1,
        games: this.data.games,
        imports: this.data.imports,
        metadata: this.data.metadata,
        name: this.data.name,
        stories,
      };
      v.parse(authoringSchema, data);
    }
    this.spans.set(data, { end: this.header.body, start: 0 });
    return {
      boards: this.boards,
      data,
      frontmatter: { end: this.header.end, start: this.header.start },
      spans: this.spans,
    };
  }
}

/** Parse YAML, CommonMark and chess directives without acquiring dependencies.
 * @param source - Original UTF-8-decoded source.
 * @returns Authored data with concrete source associations, or a syntax failure.
 */
export const parseMarkdown = (source: string): Result<MarkdownSyntax> => {
  try {
    return ok(new MarkdownReader(source).read());
  } catch (error) {
    return err("syntax", "markdown/invalid-source", String(error));
  }
};

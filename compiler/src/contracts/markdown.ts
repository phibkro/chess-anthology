import type {
  BlockContent,
  DefinitionContent,
  ListItem,
  PhrasingContent,
  Root,
  Nodes,
} from "mdast";
import * as v from "valibot";

const reference = {
  identifier: v.string(),
  label: v.optional(v.string()),
  referenceType: v.picklist(["shortcut", "collapsed", "full"]),
};
const resource = { title: v.optional(v.nullable(v.string())), url: v.string() };
const phrasing: v.GenericSchema<PhrasingContent> = v.variant("type", [
  v.strictObject({ type: v.literal("text"), value: v.string() }),
  v.strictObject({ type: v.literal("inlineCode"), value: v.string() }),
  v.strictObject({ type: v.literal("html"), value: v.string() }),
  v.strictObject({ type: v.literal("break") }),
  v.strictObject({
    children: v.array(v.lazy(() => phrasing)),
    type: v.literal("emphasis"),
  }),
  v.strictObject({
    children: v.array(v.lazy(() => phrasing)),
    type: v.literal("strong"),
  }),
  v.strictObject({
    type: v.literal("link"),
    ...resource,
    children: v.array(v.lazy(() => phrasing)),
  }),
  v.strictObject({
    type: v.literal("image"),
    ...resource,
    alt: v.optional(v.nullable(v.string())),
  }),
  v.strictObject({
    type: v.literal("linkReference"),
    ...reference,
    children: v.array(v.lazy(() => phrasing)),
  }),
  v.strictObject({
    type: v.literal("imageReference"),
    ...reference,
    alt: v.optional(v.nullable(v.string())),
  }),
]);
const listItem: v.GenericSchema<ListItem> = v.strictObject({
  checked: v.optional(v.nullable(v.boolean())),
  // oxlint-disable-next-line no-use-before-define -- Recursive CommonMark containers are evaluated lazily.
  children: v.array(v.lazy(() => block)),
  spread: v.optional(v.nullable(v.boolean())),
  type: v.literal("listItem"),
});
const block: v.GenericSchema<BlockContent | DefinitionContent> = v.variant(
  "type",
  [
    v.strictObject({
      children: v.array(phrasing),
      type: v.literal("paragraph"),
    }),
    v.strictObject({
      children: v.array(v.lazy(() => block)),
      type: v.literal("blockquote"),
    }),
    v.strictObject({
      children: v.array(phrasing),
      depth: v.picklist([1, 2, 3, 4, 5, 6]),
      type: v.literal("heading"),
    }),
    v.strictObject({ type: v.literal("thematicBreak") }),
    v.strictObject({ type: v.literal("html"), value: v.string() }),
    v.strictObject({
      lang: v.optional(v.nullable(v.string())),
      meta: v.optional(v.nullable(v.string())),
      type: v.literal("code"),
      value: v.string(),
    }),
    v.strictObject({
      type: v.literal("definition"),
      ...resource,
      identifier: v.string(),
      label: v.optional(v.string()),
    }),
    v.strictObject({
      children: v.array(listItem),
      ordered: v.optional(v.nullable(v.boolean())),
      spread: v.optional(v.nullable(v.boolean())),
      start: v.optional(v.nullable(v.number())),
      type: v.literal("list"),
    }),
  ]
);

/** CommonMark mdast without source positions or executable extensions. */
export const markdownSchema: v.GenericSchema<Root> = v.strictObject({
  children: v.array(block),
  type: v.literal("root"),
});

/** Remove source locations while retaining every semantic node property.
 * @param root - Parsed CommonMark tree.
 * @returns Validated semantic Markdown with positions removed.
 */
export const markdownData = (root: Root): Root => {
  const data = structuredClone(root);
  const strip = (node: Nodes): void => {
    delete node.position;
    if ("children" in node) {
      for (const child of node.children) {
        strip(child);
      }
    }
  };
  strip(data);
  return v.parse(markdownSchema, data);
};

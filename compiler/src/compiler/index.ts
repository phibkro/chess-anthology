// Public compiler interface. Phase implementations are internal to this module.
export {
  createCompiler,
  compile,
  selectPosition,
  type BuildSnapshot,
  type CompilerOptions,
} from "./600-build/index.js";
export {
  decode,
  envelope,
  restore,
  printStructured,
} from "./500-emission/index.js";
export {
  createPlaybackPlan,
  createPlaybackCollection,
} from "./500-emission/index.js";

export { parseStructured } from "../contracts/authored.js";
export type {
  AuthoringData,
  DocumentData,
  CompositionData,
} from "../contracts/authored.js";
export {
  parseMarkdown,
  printMarkdown,
  editMarkdownMetadata,
  editMarkdownBoard,
} from "../authoring/markdown.js";

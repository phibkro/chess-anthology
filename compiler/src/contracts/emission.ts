import type { DocumentData } from "./authored.js";
import type { ReadonlyDeep } from "./core.js";

/** An editor location measured in zero-based UTF-16 code units. */
interface SourcePosition {
  character: number;
  line: number;
}

/** A source span whose end is exclusive. */
interface SourceRange {
  end: SourcePosition;
  start: SourcePosition;
}

/** Responsible analysis phase, independent of the editor protocol. */
type DiagnosticPhase =
  | "100-parsing"
  | "200-semantic-analysis"
  | "300-linking"
  | "400-chess-analysis";

/** The kind of authoring feedback within the responsible phase. */
type DiagnosticStage =
  | "linking"
  | "acquisition"
  | "lexical"
  | "syntax"
  | "chess"
  | "semantic";

/** Plain diagnostics emitted from the framework's document lifecycle. */
export interface CompilationDiagnostic {
  code: number | string | undefined;
  message: string | { kind: "markdown" | "plaintext"; value: string };
  phase: DiagnosticPhase;
  range: SourceRange;
  severity: number | undefined;
  stage: DiagnosticStage;
}

/** A resolved board occurrence and the legal moves at its selected position. */
interface BoardOccurrence {
  fen: string;
  game: string;
  id: string;
  legalMoves: { san: string; uci: string }[];
  ply: number;
  sourceDigest: string;
  sourceUri: string;
}

/** The framework-free emission IR; diagnostics may accompany invalid authored data. */
export type EmittedDocument = ReadonlyDeep<{
  data: DocumentData | undefined;
  diagnostics: CompilationDiagnostic[];
  occurrences: BoardOccurrence[];
  sourceText: string;
  uri: string;
}>;

// Framework-owned syntax IR. Only parsing exposes generated AST types;
// plain contracts downstream never depend on this graph.
export type { Module, Scene, ChessNarrativeAstType } from "./generated/ast.js";

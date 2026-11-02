import type {
  BuildWork,
  CompilationDiagnostic,
} from "../src/contracts/index.js";

/** Operations currently covered by repeatable work budgets and timing samples. */
export type Scenario = "initial" | "prose" | "shared-game" | "unchanged";

/** Provenance needed to compare runs without confusing compiler and harness revisions. */
export interface RunIdentity {
  compilerCommit: string;
  compilerDirty: boolean;
  environment: { arch: string; cpu: string; node: string; platform: string };
  harnessDigest: string;
  lockDigest: string;
}

/** Versioned JSON correctness report; a failed evaluation exits before claiming success. */
export interface EvaluationReport extends RunIdentity {
  budgets: { scenario: Scenario; stories: number; work: BuildWork }[];
  cases: {
    diagnostics: readonly CompilationDiagnostic[];
    id: string;
    passed: boolean;
  }[];
  corpusDigest: string;
  format: "chess-compiler-evaluation";
  passed: boolean;
  version: 1;
}

/** Versioned JSON measurements; raw samples remain available alongside summaries. */
export interface BenchmarkReport extends RunIdentity {
  corpusDigest: string;
  format: "chess-compiler-benchmark";
  iterations: number;
  memoryScope: string;
  processPeakRssBytes: number;
  results: {
    medianMs: number;
    p95Ms: number;
    rssBytes: number[];
    samplesMs: number[];
    scenario: Scenario;
    stories: number;
    work: BuildWork | null;
  }[];
  timingScope: string;
  version: 1;
  warmups: number;
}

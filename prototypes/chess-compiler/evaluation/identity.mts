import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { cpus } from "node:os";

import type { RunIdentity } from "./report-contract.mjs";

/**
 * Identify the compiler checkout, dependencies, runtime and copied evaluation harness.
 * @returns Portable run metadata; compiler and harness identities are deliberately separate.
 */
export const collectIdentity = async (): Promise<RunIdentity> => {
  const compilerCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf-8",
  }).trim();
  const lockDigest = createHash("sha256")
    .update(await readFile(new URL("../pnpm-lock.yaml", import.meta.url)))
    .digest("hex");
  const harness = createHash("sha256");
  const files = [
    "benchmark.mts",
    "evaluate.mts",
    "identity.mts",
    "report-contract.mts",
    "compare.py",
    "workload.mts",
  ];
  const texts = await Promise.all(
    files.map(async (file) => await readFile(new URL(file, import.meta.url)))
  );
  for (const [i, text] of texts.entries()) {
    harness
      .update(files[i] ?? "")
      .update("\0")
      .update(text)
      .update("\0");
  }
  return {
    compilerCommit,
    compilerDirty:
      execFileSync(
        "git",
        [
          "status",
          "--porcelain",
          "--",
          "src",
          "package.json",
          "pnpm-lock.yaml",
          "tsconfig.json",
        ],
        { encoding: "utf-8" }
      ).trim() !== "",
    environment: {
      arch: process.arch,
      cpu: cpus()[0]?.model ?? "unknown",
      node: process.version,
      platform: process.platform,
    },
    harnessDigest: harness.digest("hex"),
    lockDigest,
  };
};

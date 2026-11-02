import type { RunIdentity } from "./report-contract.mjs";

const git = (args: string[]): string => {
  const child = Bun.spawnSync(["git", ...args]);
  if (child.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(child.stderr));
  }
  return new TextDecoder().decode(child.stdout).trim();
};

/**
 * Identify the compiler checkout, dependencies, Bun runtime and evaluation harness.
 * @returns Portable metadata with compiler and harness identities kept separate.
 */
export const collectIdentity = async (): Promise<RunIdentity> => {
  const lockDigest = new Bun.CryptoHasher("sha256")
    .update(
      await Bun.file(
        new URL("../pnpm-lock.yaml", import.meta.url)
      ).arrayBuffer()
    )
    .digest("hex");
  const files = [
    "benchmark.mts",
    "evaluate.mts",
    "identity.mts",
    "report-contract.mts",
    "compare.py",
    "workload.mts",
  ];
  const texts = await Promise.all(
    files.map(
      async (file) =>
        await Bun.file(new URL(file, import.meta.url)).arrayBuffer()
    )
  );
  const harness = new Bun.CryptoHasher("sha256");
  for (const [i, text] of texts.entries()) {
    harness
      .update(files[i] ?? "")
      .update("\0")
      .update(text)
      .update("\0");
  }
  const cpuInfo = await Bun.file("/proc/cpuinfo")
    .text()
    .catch(() => "");
  return {
    compilerCommit: git(["rev-parse", "HEAD"]),
    compilerDirty:
      git([
        "status",
        "--porcelain",
        "--",
        "src",
        "package.json",
        "pnpm-lock.yaml",
        "tsconfig.json",
      ]) !== "",
    environment: {
      arch: process.arch,
      cpu:
        /^model name\s*:\s*(?<capture1>.+)$/mu.exec(cpuInfo)?.[1] ??
        "unavailable",
      platform: process.platform,
      runtime: { name: "bun", version: Bun.version },
    },
    harnessDigest: harness.digest("hex"),
    lockDigest,
  };
};

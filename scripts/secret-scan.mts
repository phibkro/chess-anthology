const binary =
  Bun.env.GITLEAKS_BIN ??
  ((await Bun.file(".tools/gitleaks").exists())
    ? ".tools/gitleaks"
    : "gitleaks");
const staged = Bun.argv[2] === "staged";
const args = staged
  ? ["protect", "--staged", "--redact", "--no-banner"]
  : ["dir", "--redact", "--no-banner", "."];
try {
  const result = Bun.spawnSync([binary, ...args], {
    stderr: "inherit",
    stdout: "inherit",
  });
  process.exit(result.exitCode);
} catch {
  console.error(
    "Gitleaks is required. Run pnpm setup:secrets or install it on PATH."
  );
  process.exit(1);
}

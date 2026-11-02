import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
const binary =
  process.env.GITLEAKS_BIN ||
  (existsSync(".tools/gitleaks") ? ".tools/gitleaks" : "gitleaks");
const staged = process.argv[2] === "staged";
const args = staged
  ? ["protect", "--staged", "--redact", "--no-banner"]
  : ["dir", "--redact", "--no-banner", "."];
const result = spawnSync(binary, args, { stdio: "inherit" });
if (result.error)
  console.error(
    "Gitleaks is required. Run pnpm setup:secrets or install it on PATH."
  );
process.exit(result.status ?? 1);

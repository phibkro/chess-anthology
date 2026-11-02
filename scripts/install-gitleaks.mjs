import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { platform, arch } from "node:os";

const version = "8.30.1";
const system = { linux: "linux", darwin: "darwin" }[platform()];
const cpu = { x64: "x64", arm64: "arm64" }[arch()];
if (!system || !cpu) throw new Error("Install Gitleaks 8.30.1 on PATH for this platform.");
const filename = `gitleaks_${version}_${system}_${cpu}.tar.gz`;
const base = `https://github.com/gitleaks/gitleaks/releases/download/v${version}/`;
const get = async (name) => {
  const response = await fetch(base + name);
  if (!response.ok) throw new Error(`Gitleaks download failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
};
await mkdir(".tools", { recursive: true });
const [archive, checksums] = await Promise.all([
  get(filename),
  get(`gitleaks_${version}_checksums.txt`),
]);
const expected = checksums
  .toString()
  .split("\n")
  .find((line) => line.endsWith(filename))
  ?.split(/\s+/)[0];
if (!expected || createHash("sha256").update(archive).digest("hex") !== expected)
  throw new Error("Gitleaks checksum mismatch.");
await writeFile(".tools/gitleaks.tar.gz", archive);
execFileSync("tar", [
  "--no-same-owner",
  "-xzf",
  ".tools/gitleaks.tar.gz",
  "-C",
  ".tools",
  "gitleaks",
]);
await readFile(".tools/gitleaks");
console.log(`Installed checksum-verified Gitleaks ${version}.`);

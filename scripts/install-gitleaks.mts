const version = "8.30.1";
const system =
  process.platform === "linux" || process.platform === "darwin"
    ? process.platform
    : undefined;
const cpu =
  process.arch === "x64" || process.arch === "arm64" ? process.arch : undefined;
if (!system || !cpu) {
  throw new Error("Install Gitleaks 8.30.1 on PATH for this platform.");
}
const filename = `gitleaks_${version}_${system}_${cpu}.tar.gz`;
const base = `https://github.com/gitleaks/gitleaks/releases/download/v${version}/`;
const get = async (name: string) => {
  const response = await fetch(base + name);
  if (!response.ok) {
    throw new Error(`Gitleaks download failed: ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
};
const [archive, checksums] = await Promise.all([
  get(filename),
  get(`gitleaks_${version}_checksums.txt`),
]);
const expected = new TextDecoder()
  .decode(checksums)
  .split("\n")
  .find((line) => line.endsWith(filename))
  ?.split(/\s+/u)[0];
if (
  expected === undefined ||
  new Bun.CryptoHasher("sha256").update(archive).digest("hex") !== expected
) {
  throw new Error("Gitleaks checksum mismatch.");
}
await Bun.write(".tools/gitleaks.tar.gz", archive);
const extracted = Bun.spawnSync(
  [
    "tar",
    "--no-same-owner",
    "-xzf",
    ".tools/gitleaks.tar.gz",
    "-C",
    ".tools",
    "gitleaks",
  ],
  { stderr: "inherit", stdout: "inherit" }
);
if (extracted.exitCode !== 0) {
  throw new Error("Gitleaks extraction failed.");
}
if (!(await Bun.file(".tools/gitleaks").exists())) {
  throw new Error("Gitleaks extraction produced no binary.");
}
console.log(`Installed checksum-verified Gitleaks ${version}.`);

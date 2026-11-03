import { createProjectCompiler } from "../sources/index.js";

const args = process.argv.slice(2);
const allowed = new Set([
  "--update-sources",
  "--frozen",
  "--offline",
  "--write-manifest",
]);
if (
  args.some((arg) => arg.startsWith("--") && !allowed.has(arg)) ||
  (args.includes("--update-sources") && args.includes("--frozen"))
) {
  throw new Error(
    "Use [directory] [--update-sources | --frozen] [--offline] [--write-manifest]."
  );
}
const directory = args.find((arg) => !arg.startsWith("--")) ?? "examples";
const root = Bun.pathToFileURL(
  `${Bun.fileURLToPath(Bun.pathToFileURL(directory)).replace(/\/$/u, "")}/`
);
let mode: "locked" | "update" | "frozen" = "locked";
if (args.includes("--frozen")) {
  mode = "frozen";
}
if (args.includes("--update-sources")) {
  mode = "update";
}
const compiled = await createProjectCompiler().update({
  mode,
  offline: args.includes("--offline"),
  root,
  writeManifest: args.includes("--write-manifest"),
});
if (!compiled.ok) {
  console.error(compiled.error);
  process.exit(1);
}
for (const change of compiled.value.changes) {
  console.error(
    `Source ${change.request}: ${change.before?.blob ?? "unresolved"} -> ${change.after.blob}`
  );
}
const { output } = compiled.value.snapshot;
console.log(JSON.stringify(output, null, 2));
process.exitCode = output.some((d) =>
  d.diagnostics.some((issue) => issue.severity === 1)
)
  ? 1
  : 0;

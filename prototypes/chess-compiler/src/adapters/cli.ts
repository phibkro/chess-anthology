import { compile } from "../compiler/index.js";
import { loadDirectory } from "./files.js";

const loaded = await loadDirectory(process.argv[2] ?? "examples");
if (!loaded.ok) {
  console.error(loaded.error);
  process.exit(1);
}
const compiled = await compile(loaded.value);
if (!compiled.ok) {
  console.error(compiled.error);
  process.exit(1);
}
const { output } = compiled.value;
console.log(JSON.stringify(output, null, 2));
process.exitCode = output.some((d) =>
  d.diagnostics.some((issue) => issue.severity === 1)
)
  ? 1
  : 0;

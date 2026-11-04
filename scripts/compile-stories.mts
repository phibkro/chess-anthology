import { createPlaybackPlan } from "@chess-anthology/compiler";
import { createProjectCompiler } from "@chess-anthology/compiler/sources";

const directory = new URL("../compiler/examples/", import.meta.url);
const compiled = await createProjectCompiler().update({ root: directory });
if (!compiled.ok) {
  console.error(compiled.error);
  process.exit(1);
}
const plan = createPlaybackPlan(
  compiled.value.snapshot,
  new URL("queen-offers.chess.md", directory).href,
  "mating-nets"
);
if (!plan.ok) {
  console.error(plan.error);
  process.exit(1);
}
await Bun.write(
  new URL("../src/content/generated/queen-offers.json", import.meta.url),
  `${JSON.stringify(plan.value, null, 2)}\n`
);
console.log(
  `Compiled ${plan.value.scenes.length} board occurrences from the narrative package.`
);

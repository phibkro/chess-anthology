import { createPlaybackPlan } from "chess-compiler-prototype";
import { createProjectCompiler } from "chess-compiler-prototype/sources";

const directory = new URL(
  "../prototypes/chess-compiler/examples/",
  import.meta.url
);
const compiled = await createProjectCompiler().update({ root: directory });
if (!compiled.ok) {
  console.error(compiled.error);
  process.exit(1);
}
const plan = createPlaybackPlan(
  compiled.value.snapshot,
  new URL("story.chess-story", directory).href,
  "matingNets"
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

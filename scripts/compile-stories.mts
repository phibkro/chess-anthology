import { compile, createPlaybackPlan } from "chess-compiler-prototype";

const directory = new URL(
  "../prototypes/chess-compiler/examples/",
  import.meta.url
);
const sources = new Map(
  await Promise.all(
    [
      ...new Bun.Glob("*").scanSync({
        cwd: Bun.fileURLToPath(directory),
        dot: true,
        onlyFiles: true,
      }),
    ]
      .filter((name) => /\.(?<capture1>pgn|chess-story)$/u.test(name))
      .map(async (name) => {
        const uri = new URL(name, directory);
        return [
          uri.href,
          new TextDecoder("utf-8", { ignoreBOM: true }).decode(
            await Bun.file(uri).arrayBuffer()
          ),
        ] as const;
      })
  )
);
const compiled = await compile(sources);
if (!compiled.ok) {
  console.error(compiled.error);
  process.exit(1);
}
const plan = createPlaybackPlan(
  compiled.value,
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

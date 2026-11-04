import { toJsonSchema } from "@valibot/to-json-schema";

import {
  frontmatterSchema,
  reservedIdentifiers,
} from "../src/contracts/authored.js";
import { configFileSchema } from "../src/sources/schema.js";

const schemas = [
  ["chess.sources", toJsonSchema(configFileSchema)],
  [
    "chess.frontmatter",
    toJsonSchema(frontmatterSchema, {
      overrideAction: ({ valibotAction, jsonSchema }) =>
        valibotAction.type === "check"
          ? { ...jsonSchema, not: { enum: [...reservedIdentifiers] } }
          : undefined,
    }),
  ],
] as const;
await Promise.all(
  schemas.map(async ([name, schema]) => {
    const content = `${JSON.stringify(schema, null, 2)}\n`;
    const path = new URL(`../schemas/${name}.schema.json`, import.meta.url);
    if (process.argv.includes("--check")) {
      if ((await Bun.file(path).text()) !== content) {
        throw new Error(
          "Generated configuration schema is stale; run bun scripts/schemas.mts."
        );
      }
    } else {
      await Bun.write(path, content);
    }
  })
);

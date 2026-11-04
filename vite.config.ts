import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import formatting from "ultracite/oxfmt";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import jest from "ultracite/oxlint/jest";
import { selectJsPlugins } from "ultracite/oxlint/js-plugins";
import reactLint from "ultracite/oxlint/react";
import shadcn from "ultracite/oxlint/shadcn";
import { defineConfig } from "vite-plus";

const documentation = selectJsPlugins(["tsdoc", "jsdoc-js"]);

export default defineConfig({
  fmt: {
    ...formatting,
    ignorePatterns: [
      ...(formatting.ignorePatterns ?? []),
      "public/original/**",
      "public/revised/**",
      "pnpm-lock.yaml",
      "compiler/pnpm-lock.yaml",
      "**/*.chess.md",
      "compiler/schemas/*.json",
      "compiler/src/compiler/100-parsing/generated/**",
      "docs/4EM.md",
      "docs/CHARTER.md",
      "docs/COMMUNITY.md",
      "docs/CONTENT.md",
      "docs/DECISIONS.md",
      "docs/DELIVERY.md",
      "docs/EXPERIENCE.md",
      "docs/HANDOFF.md",
      "docs/PRODUCTS.md",
      "docs/REFERENCES.md",
      "docs/START-HERE.md",
      "docs/experiments/001-morphy-slice.md",
      "CONTRIBUTING.md",
    ],
  },
  lint: {
    env: core.env,
    extends: [core, documentation],
    ignorePatterns: [
      ...(core.ignorePatterns ?? []),
      "public/**",
      "compiler/src/compiler/100-parsing/generated/**",
    ],
    jsPlugins: [
      ...(documentation.jsPlugins ?? []),
      ...(antiSlop.jsPlugins ?? []),
      ...(shadcn.jsPlugins ?? []),
    ],
    options: { typeAware: true, typeCheck: true },
    overrides: [
      { files: ["**/*.{ts,tsx,mts,cts}"], rules: antiSlop.rules },
      {
        files: ["src/**/*.{ts,tsx}"],
        rules: { ...reactLint.rules, ...shadcn.rules },
      },
      ...(jest.overrides ?? []).map((override) => ({
        ...override,
        files: ["src/**/*.test.ts"],
      })),
    ],
    plugins: [
      ...(core.plugins ?? []),
      ...(reactLint.plugins ?? []),
      ...(jest.overrides?.[0]?.plugins ?? []),
    ],
    rules: { "import/no-nodejs-modules": "error", "no-unused-vars": "error" },
    settings: {
      shadcn: {
        note: "Use src/styles.css for shared theme and component appearance.",
      },
    },
  },
  plugins: [react(), tailwindcss()],
  server: { allowedHosts: ["terminal.local"] },
  test: { include: ["src/**/*.test.ts"] },
});

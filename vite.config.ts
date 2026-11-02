import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { allowedHosts: ["terminal.local"] },
  fmt: {
    ignorePatterns: [
      "public/original/**",
      "public/revised/**",
      "pnpm-lock.yaml",
      "prototypes/chess-compiler/pnpm-lock.yaml",
      "prototypes/chess-compiler/src/compiler/100-parsing/generated/**",
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
    ignorePatterns: [
      "public/**",
      "prototypes/chess-compiler/src/compiler/100-parsing/generated/**",
    ],
    options: { typeAware: true, typeCheck: true },
    rules: { "no-unused-vars": "error" },
  },
  test: { include: ["src/**/*.test.ts"] },
});

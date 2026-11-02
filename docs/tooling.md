# Tooling and progressive lint migration

Vite+ remains the single toolchain: `pnpm check` runs Oxlint with type-aware analysis and TypeScript checking, plus Oxfmt. Ultracite supplies presets; it does not add an ESLint or Biome check. Existing duplicate detection, Knip, Gitleaks, conventional commits, compiler seam tests and GitHub's required `quality` check remain in place.

## Preset boundaries

| Scope | Presets and checks |
| --- | --- |
| Authored JavaScript and TypeScript | Ultracite core; the project's `no-unused-vars: error` |
| All authored TS, TSX, MTS and CTS, including the compiler and tooling | Anti-slop, TSDoc syntax, public API documentation |
| `src/**/*.ts` and `src/**/*.tsx` | React and shadcn design system rules |
| `src/**/*.test.ts` | Bun tests, with Jest-compatible lint rules for the reader tests |
| Supported formatting inputs | Ultracite Oxfmt preset: JS/TS, JSON, CSS, HTML, Markdown, YAML and other Oxfmt-supported files |

Oxlint does not lint CSS, Markdown or YAML. Existing generated parser, public snapshots and historical-document exclusions are preserved. `src/styles.css` remains the frontend's theme and appearance source. The shadcn lint plugin works with the current Tailwind v4 interface; it does not require installing shadcn/ui or replacing the interface. Its component-contract rules become more useful as shared UI components and variants are introduced.

The configuration lives in `vite.config.ts`, including explicit plugin registrations for dependency analysis. React and Jest plugins are registered at the root so later migration overrides can resolve their rule names, while their presets' rules remain scoped to the frontend and Bun reader tests respectively.

Ultracite is pinned to **8.0.0**, whose Oxlint peer range includes Vite+ 1.4's Oxlint 1.89. Ultracite 8.1.1 requires Oxlint 1.90 and references rules the bundled engine cannot load. Upgrade these together after verifying compatibility.

## Runtime and lint policy

Bun **1.4.4** is the project runtime; `.bun-version` pins the tested version. **pnpm 12.16.1** remains the package manager for both package roots and their frozen lockfiles. Install Bun before installing project dependencies: the prepare hook uses it. Node is retained in CI to bootstrap pnpm and to measure the unchanged Node baseline, not to execute project scripts. pnpm's `node_modules` dependency layout remains required.

Application tooling, compiler commands, tests, source acquisition, hashes and structural comparisons use Bun. Reader and compiler tests use `bun:test`. Vite+, TypeScript, Knip, duplicate detection and commitlint are launched explicitly under Bun. Third-party dependencies may use Bun's Node compatibility internally; the LSP library's stdio transport is one such integration. Authored code may not import Node builtins: `import/no-nodejs-modules` enforces both `node:` names and bare builtin imports. Generated parser sources and dependencies retain their existing exclusions.

The inherited `lint-baseline.ts` has been removed. All authored files use the full applicable presets. Public API comments describe the actual contracts; old file names, unused classes and implicit assertions have been corrected rather than retained as migration debt.

A few narrow inline exceptions record actual boundary requirements: untrusted inputs must remain `unknown` until schemas validate them; assertions inspect arbitrary values; Langium requires asynchronous lifecycle interfaces over our synchronous memory store; edit-history tests deliberately await ordered writes; and JSON-envelope tests must exercise serialization rather than structuredClone. These are documented at the operation, not broad exceptions for existing files. Do not widen them into a new baseline.

Knip has three exact dependency-analysis exceptions for executables invoked through Bun with explicit package file paths: root `@commitlint/cli` and `jscpd`, and the compiler's `langium-cli`. The corresponding commands still execute in quality checks or the generation script; Knip cannot infer usage from interpreter file arguments. Other unused-dependency checks remain enabled.

The runtime experiment in [Compiler evaluations](compiler-evaluations.md) separates the runtime-only effect from the total migration and lint-refactor effect. It uses paired fresh processes, balanced arm ordering, confidence intervals and multiple-comparison-corrected tests. It does not assert that Bun must be faster.

## gdp-ts: considered, deferred

[gdp-ts](https://github.com/rauchg/gdp-ts) provides named values and proof types for connecting an authorization or entitlement decision to the exact value it permits. The current application is a static reader and the compiler has no application-level contributor authorization or publishing service. Adding its runtime and lint preset now would introduce a policy boundary we do not yet have.

Revisit it when adding contributor edits, reviewed publication, or rights-cleared source redistribution. A useful proof would name an immutable artifact revision and the checked principal or permission; changing the artifact must require a new check. Proof minting belongs in a small trusted policy module. Schema validation, Result values and phase-specific data contracts remain appropriate for ordinary parsing, linking and chess legality today. Proof types do not establish copyright ownership or factual accuracy on their own.

## References

- [Ultracite migration guide](https://www.ultracite.ai/docs/migrate.md)
- [Optional presets](https://www.ultracite.ai/docs/presets)
- [Language support](https://www.ultracite.ai/docs/languages)
- [shadcn lint](https://github.com/shadcn-ui/lint)

The default development server binds localhost. In the managed test environment, Bun network-interface enumeration for `--host 0.0.0.0` is restricted (`getifaddrs`); localhost preview starts and serves the production build successfully. Explicit all-interface binding remains available on environments that permit it.

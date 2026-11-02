# Tooling and progressive lint migration

Vite+ remains the single toolchain: `pnpm check` runs Oxlint with type-aware analysis and TypeScript checking, plus Oxfmt. Ultracite supplies presets; it does not add an ESLint or Biome check. Existing duplicate detection, Knip, Gitleaks, conventional commits, compiler seam tests and GitHub's required `quality` check remain in place.

## Preset boundaries

| Scope | Presets and checks |
| --- | --- |
| Authored JavaScript and TypeScript | Ultracite core; the project's `no-unused-vars: error` |
| All authored TS, TSX, MTS and CTS, including the compiler and tooling | Anti-slop, TSDoc syntax, public API documentation |
| `src/**/*.ts` and `src/**/*.tsx` | React and shadcn design system rules |
| `src/**/*.test.ts` | Vitest; compiler tests use Node's test runner instead |
| Supported formatting inputs | Ultracite Oxfmt preset: JS/TS, JSON, CSS, HTML, Markdown, YAML and other Oxfmt-supported files |

Oxlint does not lint CSS, Markdown or YAML. Existing generated parser, public snapshots and historical-document exclusions are preserved. `src/styles.css` remains the frontend's theme and appearance source. The shadcn lint plugin works with the current Tailwind v4 interface; it does not require installing shadcn/ui or replacing the interface. Its component-contract rules become more useful as shared UI components and variants are introduced.

The configuration lives in `vite.config.ts`, including explicit plugin registrations for dependency analysis. React and Vitest plugins are registered at the root so later migration overrides can resolve their rule names, while their presets' rules remain scoped to the frontend and Vitest tests respectively.

Ultracite is pinned to **8.0.0**, whose Oxlint peer range includes Vite+ 1.4's Oxlint 1.89. Ultracite 8.1.1 requires Oxlint 1.90 and references rules the bundled engine cannot load. Upgrade these together after verifying compatibility.

## Existing-code baseline

`lint-baseline.ts` records existing violations as exact file/rule pairs. It is a migration backlog, not a second recommended configuration. New files inherit the complete applicable presets. The compiler's build/snapshot and codec APIs already have documented contracts; other existing exports remain migration work.

The initial scan found 945 diagnostics in 35 files after formatting. This includes style preferences, missing API comments, existing test assertions, React button attributes, and anti-slop checks on assertions and runtime boundary validation. The latter need judgment: untrusted-input decoding legitimately accepts unknown values, and tests deliberately probe mutation and malformed inputs. Keep the compiler's errors-as-values and validation guarantees when resolving these.

To reduce the baseline, remove a rule from one file's entry, run `pnpm check`, address its diagnostics, and run the relevant tests. Delete empty entries. Do not add directory-wide exceptions or regenerate the baseline automatically during CI. An existing file's exception also covers new code added to that file; review those changes explicitly until the entry is removed. The project's pre-existing `no-unused-vars` rule and TypeScript checking are not baselined.

Formatting is isolated in a mechanical commit listed in `.git-blame-ignore-revs`. Use `git config blame.ignoreRevsFile .git-blame-ignore-revs` to hide that revision when investigating history. This works on the migration branch. The repository currently requires squash merges, which replace that revision on main; after merging, add the resulting squash commit to this file if it should also be ignored there. That will ignore the configuration changes in the same squash. Avoid blindly running lint autofixes: the documentation plugin can insert empty comments, which do not explain a public contract.

## gdp-ts: considered, deferred

[gdp-ts](https://github.com/rauchg/gdp-ts) provides named values and proof types for connecting an authorization or entitlement decision to the exact value it permits. The current application is a static reader and the compiler has no application-level contributor authorization or publishing service. Adding its runtime and lint preset now would introduce a policy boundary we do not yet have.

Revisit it when adding contributor edits, reviewed publication, or rights-cleared source redistribution. A useful proof would name an immutable artifact revision and the checked principal or permission; changing the artifact must require a new check. Proof minting belongs in a small trusted policy module. Schema validation, Result values and phase-specific data contracts remain appropriate for ordinary parsing, linking and chess legality today. Proof types do not establish copyright ownership or factual accuracy on their own.

## References

- [Ultracite migration guide](https://www.ultracite.ai/docs/migrate.md)
- [Optional presets](https://www.ultracite.ai/docs/presets)
- [Language support](https://www.ultracite.ai/docs/languages)
- [shadcn lint](https://github.com/shadcn-ui/lint)

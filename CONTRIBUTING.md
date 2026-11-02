# Contributing to Chess Anthology

Thank you for helping make chess history and composed chess art more enjoyable, accurate and accessible. This project is **early-stage**: there is currently no released application, selected software license or finalized community publishing standard.

Begin with [START-HERE](docs/START-HERE.md), [CHARTER](docs/CHARTER.md) and [COMMUNITY](docs/COMMUNITY.md).

## Good early contributions

- Historical source corrections, composer attribution research, and soundness reviews.
- Reader UX prototypes that test a real recorded game or a real composition.
- Accessible board/playback improvements and reliable chess-data validation.
- Original concise, cited historical/editorial writing.
- Source-license research and constructive architecture proposals.

Before submitting copyrighted content or code, review the open licensing decisions in [COMMUNITY](docs/COMMUNITY.md). **Do not assume a license has been granted by this repository's public visibility.**

## Proposed contribution workflow

1. Describe the goal, affected product, historical source and desired reader experience in an Issue or small PR.
2. Keep changes bounded and testable; cite existing Goal / Rule / Requirement IDs in [4EM](docs/4EM.md) if relevant.
3. For chess changes, include position/PGN, reproducible legality or solution verification, and source attribution.
4. For historical changes, supply evidence and represent disputes honestly.
5. For UX changes, explain how a reader can exercise control and access the experience without sound or a mouse.
6. For AI-assisted changes, describe the tool's role; verify generated facts and citations independently.

Editorial disagreements and factual corrections deserve respectful discussion, not engagement-driven voting.
## Prototype development

Use Node 24.11+ and the pinned pnpm version. Run `pnpm install` and `pnpm setup:secrets` once. Installation enables Vite+ hooks; `pnpm exec vp hooks status` reports their state.

Use Conventional Commits, for example `feat(lesson): add a composition checkpoint`. The commit-message hook checks the message. Pre-commit runs Oxfmt, Oxlint/type checks, lesson tests, jscpd, Knip and a staged Gitleaks scan. Gitleaks is required and its absence fails the hook; install it on PATH or run the checksum-verified setup script.

Run `pnpm check:all` and `pnpm check:secrets` before pushing. CI repeats these checks. Archived design comparisons in `public/` are intentional snapshots, excluded from active-code duplication and dead-code checks.

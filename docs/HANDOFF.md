# Technical lead handoff

**Mandate:** Deliver an exceptional, playable chess-history and composition experience while preserving original mission and contributor autonomy. You own implementation tradeoffs; the project charter and product distinctions specify *why*, not a required stack.

## Start with these files

[CHARTER](CHARTER.md) → [4EM](4EM.md) → [PRODUCTS](PRODUCTS.md) → [EXPERIENCE](EXPERIENCE.md) → [CONTENT](CONTENT.md) → [DELIVERY](DELIVERY.md) → [first experiment](experiments/001-morphy-slice.md).

## Decisions already made

- Project: **Chess Anthology**; products: **Chess Through History** and **The Art of Chess Composition**.
- Intent: open-source, craft-first, factual, source-aware, accessible and exploratory.
- Board and story are synchronized, but prompts and audio are optional.
- Portable artifacts are valuable; PGN/FEN should be reused rather than replaced.
- AI may be an optional, inspectable librarian; it must not silently invent history.
- First target is a complete composition and an historic game, not a platform backend.
- Avoid engagement optimization and premature business infrastructure.

## Decisions delegated to lead (write short ADRs where valuable)

| Choice | Constraints | Suggested evidence |
| --- | --- | --- |
| Web framework/build tool | Fast visual iterations, accessible UI, easy contributions | Working clickable slice |
| Rules/PGN/board dependencies | Verify variant and licensing compatibility; open-source goals | Reproducible chess tests |
| Storybeat representation | Readable, exportable, validated; real artifact first | Two different authored artifacts |
| Media and timing | Sound-off first, no autoplay burden | Experience review |
| Content storage | Simple file-based content before services | Local import/export demonstrator |
| Test/CI/deployment | Legality, provenance and UX regression checks | Passing pipeline |
| Contribution and code licenses | Distinguish software from text/media/database rights | Documented legal choice |
| Initial architecture | Minimal modules; no platform service without tested need | ADR + completed tracer bullet |

## Important risks

- Misrepresenting a composition as a played game; misleading composer attribution.
- Incorrect board state, challenge anchors or solution variations.
- Automatic narratives that sound plausible but use invented historical context.
- Attractive but unreadable boards or intrusive sound/motion.
- Incorrect assumptions about upstream PGN annotations or image/database reuse rights.
- Choosing dependency licenses incompatible with intended distribution.
- Architecture complexity before evidence of a reusable format or service.

## First implementation task

Complete [Experiment 001](experiments/001-morphy-slice.md) with an explicit effort appetite. Define only enough architecture to render, play, cite and inspect that artifact. Then make **Opera Game** the second slice to test the same foundations from the historical-game side.

### Definition of done (for the first experiment)

A usable hosted/local preview, a correctly functioning board, validated puzzle behavior, comprehensible graded hints, original editorial introduction, visible historical uncertainty, keyboard/sound-off support, and a brief evaluation of what worked or failed.

## Suggested team practice

- Use **Tickets** containing purpose, constraints, acceptance criteria and verification rather than orders specifying implementation details.
- Avoid assigning imagined org roles to nonexistent people; researcher, editor, chess reviewer, developer and steward are responsibilities.
- Pair machine-generated investigation with human review and substantive citations.
- Keep proposals/decisions as small PRs and retain an open issue for unresolved historical and licensing questions.
- After each experiment, hold a short review: what was built, what was learned, what goal/rule/requirement changes.

## Questions to resolve early, not in advance

What are the required fidelity and variation semantics for a normal game versus a formal composition? What is the minimal content authoring representation after two real samples? Which dependency licenses are compatible? Which historical original materials can be redistributed? Can a single design serve both products without flattening them?

## Explicitly not requested

A sprint bureaucracy, investor pitch, market-size spreadsheet, service decomposition, agent orchestration platform, formal corporate structure, or monetization plan.
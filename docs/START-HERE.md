# Start here — reading map for incoming leads

**Purpose:** Transfer the project's intent, its two editorial products, known constraints, unresolved choices, and the first testable increments to an implementation team without prescribing a premature platform.

## Read in this order

| Read | Question it answers | Output |
| --- | --- | --- |
| [CHARTER](CHARTER.md) | Why should this exist, and who benefits? | Mission, boundaries, value proposition |
| [4EM](4EM.md) | How do goals, rules, actors, processes, concepts, and technical needs relate? | Traceable goal model |
| [PRODUCTS](PRODUCTS.md) | Why exactly two products; where do they differ? | Editorial product hypotheses |
| [EXPERIENCE](EXPERIENCE.md) | What does high-quality interaction actually mean? | UX and editorial guardrails |
| [CONTENT](CONTENT.md) | What must a chess artifact carry? | Source-aware conceptual model |
| [DELIVERY](DELIVERY.md) | How do we turn intent into tested software? | Tracer-bullet sequence and gates |
| [HANDOFF](HANDOFF.md) | What is the technical lead empowered to decide? | Working agreement and first decisions |
| [COMMUNITY](COMMUNITY.md) | How can others participate fairly without premature bureaucracy? | Lightweight stewardship |
| [REFERENCES](REFERENCES.md) | What external evidence informs this? | Sources and reusable prior art |

## Where we are now

- **Known intent:** A personally desirable, polished, exploratory chess library; not another chess performance app.
- **Two products:** Chess Through History and The Art of Chess Composition.
- **Known first examples:** Morphy's composed mate-in-two (historical attribution requires explicit caution) and his 1858 Opera Game (historical game narrative).
- **Open intent:** Share the application and eventually a portable narrative/lesson format; the actual license and spec are undecided.
- **Unknowns:** Chosen web stack and board library, media interaction design, composition solver requirements, content licensing and import permissions, governance at scale, exact release appetite.
- **No implicit commitments:** No account system, AI tutor, engagement algorithm, payment service, large content database, graph database, or multi-service infrastructure.

## Handoff contract

A technical lead should first:
1. Read the documents and flag inaccuracies, overspecification, and missing evidence.
2. Create a playable thin vertical slice using one composition and a second historical game.
3. Evaluate the experience with the creator and a handful of chess-curious readers.
4. Record architectural decisions as short ADRs only when needed; keep current alternatives open.
5. Revisit goals and assumptions with evidence at the end of each slice.

**A good handoff is not a frozen requirements document.** It preserves the reason for the product while granting implementation autonomy and maintaining explicit feedback loops.
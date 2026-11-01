# Content and provenance — conceptual contract

This is a **conceptual vocabulary and validation contract**, not a finalized file schema or database design. The technical lead should first validate it against two real documents before standardizing syntax.

## Source artifact versus authored interpretation

- **Artifact record:** Historical game or chess composition; source identifiers; authors/players; moves/position; factual metadata; origin and variant.
- **Narrative record:** Original story, context, interpretations, prompts, graded hints, media cues, references, and board-state anchors.
- **Collection:** Grouping by person, event, era, tournament, match, composition theme, editor, or creator; can contain both products when explicitly labeled.
- **Provenance record:** Source URL/bibliographic information, original publication, what it supports, retrieval/verification date, use rights, attribution and unresolved conflicts.

These must be separable so that imported PGNs remain useful even without narrative prose, and editorial changes do not corrupt recorded chess data.

## Example fields to test

| Kind | Minimal fields | Further fields |
| --- | --- | --- |
| Game | ID, PGN, source, White/Black if known | event, round, date/site and certainty, variants, related match |
| Composition | ID, FEN, stipulation, author status, source, intended solution | first publication, version, theme, soundness, cooks/duals, applicable chess variant |
| Narrative | ID, artifact IDs, author/editor, ordered beats | checkpoints, hint sequence, media, chronology references, translations |
| Beat | narrative ID, chess anchor, prose, kind | interaction, alternatives, reveal, citations, optional media timing |
| Claim | claim text, supported-by reference(s), confidence/status | opposing source, correction history, editorial note |
| Source | origin, title/author if known, linked claims, license status | archive identifier, image credit, access date |
| Collection | ID, title, curator, links | ordering rationale, epoch, associated people |

### Stable chess anchors

For a game, prefer anchors derived from a validated game tree: initial position + path of legal moves. A mere move number can become ambiguous when annotations introduce branches. For a composition, use initial FEN + solution/variation path and explicit stipulation. The renderer must not assume that the first legal mate found by a generic engine is the composer's intended artistic solution.

## State and confidence

Suggested labels: **source-backed**, **editorially interpreted**, **disputed**, **unverified/imported**, **corrected**, **withdrawn**. These labels are not probabilities. Record a note or evidence for judgments. Generated citations should be confirmed against original source text.

### Chess-specific verification

- Parse PGN and verify legal moves from starting position, including branches.
- Parse FEN and validate side to move/rules state; legality of retro or fairy compositions needs specialized handling.
- Check that a challenge's expected move is legal at its anchor, and that hints/reveal correspond to the same line.
- For compositions, verify the stipulated task and solution with composition-aware tools or specialist human review where necessary. Report **cooks** and **duals** rather than silently discarding them. See [WFCC Codex](https://www.wfcc.ch/rules/codex/).
- Retain alternative historical records and disputed authorship without choosing whichever supports the best story.

## Authoring and openness

Prefer existing PGN/FEN as chess interchange; human-readable Markdown for narrative; a small explicit manifest for metadata; relative links for media; and an import/export contract. **Do not freeze a brand-new universal format now.** Prototype document authoring during the vertical slice and record what actual authoring needed.

Agents may search, deduplicate, generate draft metadata, summarize sources, propose story beats, and discover illustrative material. They may not automatically certify rights, historicity, or compositional soundness.

## Rights and credit

Moves and facts should be distinguished from expressive annotation, original research, photography, scans, translations, database extraction rights and software licenses. Treat each source's rights independently. Do not assume a public URL authorizes redistribution. Store permissions and attribution on each reused asset; link out when reuse permission is uncertain. The project's future software and content licenses need separate decisions.

## Version and correction practices

Keep content in version control; record who edited explanatory text and why; preserve original artifact identifiers; distinguish historical correction from editorial reinterpretation. A source dispute should become inspectable content, not a quiet rewrite.
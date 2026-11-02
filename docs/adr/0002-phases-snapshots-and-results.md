# Explicit compiler seams, immutable snapshots and error values

Accepted for the compiler experiment, 2026-11-02. Keep modules internal for now, with entrypoint interfaces and numbered responsibilities: parsing, local semantic analysis, linking, chess analysis, emission and incremental builds. This makes their contracts and verification visible without creating a package or service per phase.

Make immutable game/build snapshots first-class; selecting a historical position is a read, not an event to append. Source changes and external effects are explicit commands. Use dependency-based invalidation and content-addressed game analysis so editing prose does not replay games and old snapshots remain usable.

Use discriminated result/error values for expected failures and normalize third-party exceptions at adapters. Test seams with property-based and bounded fuzz checks, including flat/structured round-trips and incremental-vs-clean equivalence. See [the module interfaces](../../MODULES.md) for current contracts, observed implementation scope and limitations.

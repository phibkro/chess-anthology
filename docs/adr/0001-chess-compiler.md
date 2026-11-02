# A shared TypeScript chess compiler

Accepted for initial development, 2026-11-02. Implement the chess compiler as a TypeScript library consumed by browser workers, CLI, LSP and an optional hosted API. This reuses chessops and our frontend types without making authoring depend on a network service; JVM/Xtext and Rust remain alternatives if measured needs justify another runtime.

The public contract is versioned plain structured data validated independently of parser-framework objects. Keep authored documents, lossless syntax information, resolved dependencies, derived chess positions and reader session state distinct. Native flat/structured codecs preserve all authored information; narrower exports report losses explicitly.

Imports and references survive unavailable dependencies. Linking resolves configured sources into a reproducible bundle with provenance and pinned content identities. Move occurrences retain game and branch context even when their resulting positions match; FEN/EPD position indexes do not replace occurrence identity or history.

Use shared structural, reference and chess validation for all input representations, with stable diagnostic codes and structured paths plus source ranges when available. LSP is an adapter over those results. Configurable operations enforce their prerequisites rather than allowing an invalid arbitrary pass ordering.

Langium is an experimental language frontend, not an accepted public syntax or serialization format. The [prototype](../experiments/003-langium-compiler.md) evaluates linking, diagnostics, source preservation and language services before adopting it more broadly. See the [codec contract](../authoring-codec-contract.md) for preservation and projection requirements.

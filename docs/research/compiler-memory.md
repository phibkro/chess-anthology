# Compiler memory and data layout

This change captures one source revision for each build, bounds inactive replay retention, maintains dependency indexes across updates and emits shared playback histories. It also reuses position projections, avoids rehashing cached source text, validates/replays the mainline in one tree traversal, caches project dependency discovery and re-sorts output identities only when membership changes.

## Measured workload

The [raw record](evidence/compiler-memory-results-2026-11-04.json) includes every sample, Bun/platform identity, source and harness digests, fixture/lockfile digests, and dirty state. Baseline is main commit `8d7cf9a98b4c040a539a2ee8c1ec373f0ebb965e`; candidate code is identified by its source digest. The raw record identifies the local candidate code revision and source state used for measurement; `publishedEquivalentCommit` identifies the identical tree available on GitHub.

Three fresh processes per revision and mode; 200 sequential updates to one story referencing the Opera Game. The PGN workload edits the Event tag without changing moves. Each sample forces JavaScriptCore full GC and sweeping. Public snapshots are not accumulated by the caller. All builds must remain valid.

Median retained JSC heap, decimal MB:

| Mode | Baseline initial | Baseline after 200 | Candidate initial | Candidate after 200 |
| --- | --: | --: | --: | --: |
| Unchanged | 7.7 | 7.9 | 7.7 | 7.9 |
| Prose edits | 7.7 | 9.9 | 7.7 | 9.8 |
| PGN metadata edits | 7.7 | 16.0 | 7.7 | 10.9 |

The replay-version workload shows lower retained heap under the new default inactive budgets. This is exploratory evidence, not an allocation profile, peak RSS measurement, leak proof or statistically established speed improvement. GC timing, JIT/runtime retention and allocation churn are not isolated. Active games and caller-retained snapshots remain live independently of inactive budgets.

A separate 100-scene story references the same 34-frame game at every scene:

| Representation                | Serialized bytes | Stored frame records |
| ----------------------------- | ---------------: | -------------------: |
| Version 1: frames per scene   |          347,466 |                3,400 |
| Version 2: one shared history |           28,155 |                   34 |

These are actual emitter outputs, not an estimated schema. Unique-game stories will not receive the same payload reduction.

## Contracts and retention

`createCompiler().update` shallow-copies the source map at entry and uses that captured map throughout the awaited update. Text strings remain shared. Mutating the caller's map cannot mix occurrence provenance and game history from different revisions.

Default inactive LRU budgets are 32 entries, 1,024 engine positions and 4 MiB of UTF-8 source text. The source-byte budget also applies to failed entries and large metadata records. Active input games are protected even above these limits. These are policy budgets, not exact heap-byte accounting. Old immutable snapshots stay valid when compiler cache entries are evicted. `cacheStats()` reports owned counters without triggering replay.

Playback format 2 stores histories by source digest and scene references by `historyId`. The browser parser accepts format 1, detects conflicting legacy histories and returns normalized format 2. It validates scene/history references, anchors and duplicate scene IDs. Browser/session code reads histories through `playbackFrames`.

The source-project adapter reports `acquisition.parsedNarratives` separately from kernel work. Unchanged dependency discovery is reused. Dependency caches prune unvisited modules after successful or failed acquisition. Local bytes are still reacquired to observe edits; durable blob integrity checks remain enabled.

The editor adapter also retires orphaned game text after imports change or modules are deleted. Open buffers and current references remain protected. Completed acquisition promises and generation tokens are released; unique tokens preserve out-of-order read safety.

## Reproduce

With an installed baseline checkout and Bun 1.4.4 on PATH:

```sh
python3 compiler/evaluation/memory_compare.py \
  /path/to/baseline/compiler compiler report/memory

pnpm check:all
```

The comparison stages the identical worker against each implementation. Memory values are descriptive; correctness and deterministic cache-budget tests are blocking. No timing or heap-size threshold is added to CI.

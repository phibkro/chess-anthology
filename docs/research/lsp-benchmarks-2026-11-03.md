# LSP measurements — 3 November 2026

Median milliseconds across fresh server processes. The [measurement record](evidence/lsp-results-2026-11-03.json) includes identities, acceptance outcomes and corrected inference; [raw samples](evidence/lsp-samples-2026-11-03.json) use explicitly ordered axes. Full wire transcripts are retained in the CI artifact.

| Mode | Stories | First diagnostics | Prose edit | Recovery | Completion | Definition |
| --- | --: | --: | --: | --: | --: | --: |
| bun-source | 1 | 191.487 | 2.416 | 2.094 | 1.182 | 0.459 |
| bun-source | 10 | 205.314 | 2.224 | 2.164 | 1.279 | 0.444 |
| bun-source | 100 | 275.713 | 2.116 | 2.057 | 1.265 | 0.429 |
| bun-bundle | 1 | 159.676 | 2.056 | 1.888 | 1.111 | 0.467 |
| bun-bundle | 10 | 172.643 | 2.325 | 1.968 | 1.483 | 0.510 |
| bun-bundle | 100 | 233.002 | 2.221 | 1.950 | 1.084 | 0.429 |
| bun-executable | 1 | 149.687 | 2.503 | 2.264 | 1.719 | 0.475 |
| bun-executable | 10 | 174.576 | 2.517 | 1.868 | 1.274 | 0.472 |
| bun-executable | 100 | 226.417 | 2.302 | 2.018 | 1.110 | 0.441 |
| bun-bytecode | 1 | 80.751 | 2.130 | 2.184 | 1.719 | 0.503 |
| bun-bytecode | 10 | 91.202 | 2.931 | 1.906 | 1.186 | 0.494 |
| bun-bytecode | 100 | 156.411 | 2.291 | 1.861 | 1.163 | 0.487 |
| go-native | 1 | 14.518 | 0.396 | 0.381 | 0.328 | 0.196 |
| go-native | 10 | 15.873 | 1.059 | 1.020 | 0.356 | 0.222 |
| go-native | 100 | 30.390 | 6.872 | 6.697 | 0.883 | 0.329 |
| node-tsx | 1 | 698.880 | 1.495 | 1.168 | 1.020 | 0.452 |
| node-tsx | 10 | 725.847 | 1.178 | 1.176 | 1.105 | 0.486 |
| node-tsx | 100 | 755.121 | 1.592 | 1.578 | 1.132 | 0.472 |
| node-bundle | 1 | 187.874 | 1.516 | 1.275 | 1.993 | 0.631 |
| node-bundle | 10 | 203.856 | 1.290 | 1.235 | 1.165 | 0.496 |
| node-bundle | 100 | 254.459 | 1.561 | 1.370 | 0.959 | 0.455 |
| node-sea | 1 | 174.920 | 1.550 | 1.278 | 1.319 | 0.544 |
| node-sea | 10 | 189.782 | 1.427 | 1.217 | 1.113 | 0.485 |
| node-sea | 100 | 237.214 | 1.406 | 1.362 | 0.921 | 0.492 |
| node-sea-cache | 1 | 155.222 | 1.787 | 1.369 | 1.399 | 0.564 |
| node-sea-cache | 10 | 167.608 | 1.535 | 1.242 | 1.149 | 0.584 |
| node-sea-cache | 100 | 224.040 | 1.645 | 1.309 | 0.949 | 0.456 |
| legacy-bun-source | 1 | 172.326 | 1.955 | 1.616 | 1.145 | 0.472 |
| legacy-bun-source | 10 | 183.757 | 1.556 | 1.405 | 1.208 | 0.411 |
| legacy-bun-source | 100 | 230.549 | 1.534 | 1.335 | 1.167 | 0.455 |

Historical Node is a separate frozen compiler revision and has explicitly recorded feature gaps. These are whole-server comparisons, not isolated language/runtime effects.

Bun executable builds package JavaScriptCore; bytecode builds precompile JavaScript bytecode. Neither is native ahead-of-time compilation.

Run: 16 paired blocks, five edit/query repetitions per server, 1/10/100 stories, ten modes (480 timed server processes). These local measurements use naturally warm filesystem caches. See [method and limitations](../compiler-lsp-evaluations.md).

Go reaches first diagnostics sooner in this workload, while Bun has lower 100-story edit latency. The Go adapter still receives a defensive copy of the full workspace snapshot and publishes each document’s diagnostics; these are implementation differences that require profiling before attributing cost to a particular operation.

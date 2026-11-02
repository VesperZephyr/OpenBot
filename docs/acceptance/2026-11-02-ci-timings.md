# I8 CI Timing Acceptance — November 2, 2026

Scope and contract: [I8](../tasks/i8-ci-timings.md). All remote runs use standard GitHub-hosted runners. No existing product test is removed, skipped, retried or weakened.

## Audit context

The preceding audit covered the latest 50 workflow runs from October 27 10:26 UTC through November 2 03:49 UTC: 34 successful, 12 failed and 4 cancelled, with 166 jobs. Separate workflow generations rather than treating all 50 as one performance baseline:

| Layout | Runs / successful | Successful workflow median | Successful workflow p95 |
| --- | ---: | ---: | ---: |
| Serial | 21 / 14 | 708.5 s | 822 s |
| Sharded, before Pi cache | 5 / 3 | 367 s | 385 s |
| Sharded with Pi cache | 24 / 17 | 286 s | 503 s |

These cohorts contain different product revisions. They identify the direction of investigation, not a causal comparison for this change. The current layout already caches Pi and runs four macOS jobs in parallel. Across successful sharded jobs, setup medians were approximately 38–39 seconds, builds 14.5–16 seconds, check 102.5 seconds, history 63 seconds and desktop shards 177.5–186.5 seconds. Median queue was 4 seconds, with a much longer tail. These are separate component medians, not additive workflow estimates.

The actionable defect was file timing: JSON test-case spans excluded file-level hooks and understated the cost used for shard assignment. Keep the existing concurrency, isolation and test coverage; correct the measurements before changing execution strategy. The unchanged-runtime baseline below avoids mixing older workflow layouts into the before/after result.

## Baseline

The documentation-only baseline `58df20a` starts from main `1b550b9`, with unchanged runtime, tests, workflow and weights. [Run 41388840202](https://github.com/VesperZephyr/OpenBot/actions/runs/41388840202) passed all jobs.

- Workflow creation to final job completion: 325 seconds.
- E2E test steps for shards 1/2/3: 192 / 194 / 226 seconds.
- Check: 118 seconds; isolated history test: 62 seconds.

API job/step timestamps have second precision. Queue and setup/build are separate from test steps. Different runs remain subject to runner/queue/cache variation; single samples do not establish p95 or an isolated causal speedup.

## Local verification

- Final `pnpm run check` passed boundaries, types and all 711 tests across 103 files.
- Frozen dependency installation and initial vendored Pi build passed; no vendor files changed.
- Full background desktop regression passed: 212 tests across 54 suites, no skips, 331.14 seconds of Vitest execution.
- Inspected history search/anchor in dark mode, Chinese minimum-size approval and restored/paused backup screenshots. Relevant content and controls remain visible.
- The timing fixture proves both file hooks are counted and unsuccessful execution cannot train weights. A startup marker invalidates a previous success before a hard process interruption can leave it reusable.
- Initial local weights were refreshed from all 54 complete module records, then replaced with the comparable CI calibration below.

## CI calibration and final comparison

The instrumented candidate `ffb6e45` passed [run 41389603484](https://github.com/VesperZephyr/OpenBot/actions/runs/41389603484) with all 212 e2e cases and 711 check tests. Its workflow took 294 seconds; e2e steps for shards 1/2/3 took 210 / 175 / 213 seconds. This uses the initial local weights, not the final CI-calibrated weights.

All four successful CI timing artifacts contain 54 distinct suites with no overlap. Final weights are refreshed from these complete CI costs, replacing all local samples. The observed 325-to-294-second change is a single-run comparison, not an established speedup distribution.

## Weighted-run failure investigation

[Run 41390464540](https://github.com/VesperZephyr/OpenBot/actions/runs/41390464540), revision `4f6f0f4`, failed shard 2. Its first failure was Chromium `Page.captureScreenshot: Unable to capture screenshot` in `memory-provenance.e2e.ts` at the first screenshot, after the source attribution assertion passed. That abort left the profile panel open; the next three cases timed out because `.details-scrim` intercepted clicks. The other two shards and check/history passed. The failed timing sample is explicitly ineligible for weights and the required gate correctly failed.

The same four memory-provenance cases passed in the subsequent full local I9 regression using the identical I8 weights/reporter, including all screenshots. There is no demonstrated product/assertion regression or deterministic weight-selection defect; the underlying native capture failure remains unexplained. No tests, screenshot requirements, timeouts or retry policies were changed. Keep this failed run visible, and validate the unchanged weighted implementation in a fresh full CI run after this evidence update; do not count the failed execution as a speedup sample.

## Verified weighted result

[Run 41391016704](https://github.com/VesperZephyr/OpenBot/actions/runs/41391016704), revision `3bb1c0f`, passed every job with the same executable files and weights as `4f6f0f4`; only the audit/failure record changed. Workflow elapsed was **289 seconds versus 325 seconds** for the unchanged-runtime baseline: 36 seconds (11.1%) lower in this pair. The longest desktop test step was 205 seconds versus 226 seconds. This is observed latency, not proof of a stable percentage improvement; shard spread remains 34 seconds in both runs, so the evidence does not establish improved runtime balance.

| Run / job | Queue | Setup | Build | Check | E2E test step |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline / check + history | 3 s | 40 s | 18 s | 118 s | 62 s |
| Baseline / shard 1 | 3 s | 35 s | 11 s | — | 192 s |
| Baseline / shard 2 | 4 s | 38 s | 18 s | — | 194 s |
| Baseline / shard 3 | 4 s | 52 s | 28 s | — | 226 s |
| I8 / check + history | 4 s | 37 s | 12 s | 110 s | 66 s |
| I8 / shard 1 | 4 s | 36 s | 15 s | — | 205 s |
| I8 / shard 2 | 4 s | 45 s | 18 s | — | 205 s |
| I8 / shard 3 | 3 s | 34 s | 11 s | — | 171 s |

Durations use GitHub job/step timestamps at second precision. Queue is job creation to runner start; setup contains checkout, dependency/Electron preparation and cache restore. Build contains desktop compilation and any Pi build. Check includes boundaries, types and unit tests; e2e is the separate test invocation. Upload/post-cleanup, orchestration gaps and the final required gate are outside these columns but included in workflow elapsed. The four macOS jobs run in parallel, so their durations must not be summed to estimate PR wait time.

The measurement defect, stale-success rejection and shard-selection safety are verified. Continued observations with these artifacts are needed to assess stable speed/balance and the unexplained native screenshot failure; this increment does not remove that risk.

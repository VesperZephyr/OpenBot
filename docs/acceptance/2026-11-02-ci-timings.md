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

# I8 CI Timing Acceptance — November 2, 2026

Scope and contract: [I8](../tasks/i8-ci-timings.md). All remote runs use standard GitHub-hosted runners. No existing product test is removed, skipped, retried or weakened.

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
- Initial local weights are refreshed from all 54 complete module records. Final weights will use the comparable CI environment instead.

## CI calibration and final comparison

The instrumented candidate `ffb6e45` passed [run 41389603484](https://github.com/VesperZephyr/OpenBot/actions/runs/41389603484) with all 212 e2e cases and 711 check tests. Its workflow took 294 seconds; e2e steps for shards 1/2/3 took 210 / 175 / 213 seconds. This uses the initial local weights, not the final CI-calibrated weights.

All four successful CI timing artifacts contain 54 distinct suites with no overlap. Final weights are refreshed from these complete CI costs, replacing all local samples. The final weighted run remains pending. The observed 325-to-294-second change is a single-run comparison, not an established speedup distribution.

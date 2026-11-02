# E2E cost audit — 2026-11-02

Status: measurement in progress. This branch is a profiling spike, not a proposed product change or an optimization ready to merge.

## Scope and method

Baseline: main at `f45a70728f2ce0012db9288cd5d6fe803614fa73`, after I8 and I9. Retain all 54 E2E files, 212 cases, assertions, screenshots, per-file state isolation, worker counts, timeout limits, recovery paths, and required CI gates. Use the existing standard GitHub-hosted macOS runners only.

Compare completed CI runs 41389603484, 41392279691, and 41398945996. Their file execution reports include hooks; subtracting case durations is only a preliminary estimate of non-case work, not an exact hook measurement.

The opt-in `OPENBOT_E2E_AUDIT=1` probe records worker-side hook intervals and harness operations: initial fixture setup, Electron launch, first window, sidebar readiness, repeated UI Bot setup, Host calls, render frames, screenshots, relaunch, native credential cleanup, app close, and mock-model stop. It records names and timings, never API parameters or results. All intervals include awaited work. Hooks contain harness operations and must not be added to them. Per-file and pooled elapsed times across parallel workers are not workflow wall time.

A synthetic fixture with 120 ms beforeAll and afterAll validates hook accounting independently of reporter event batching. File-level Vitest timing artifacts remain the authoritative shard-weight input. This probe does not update weights.

Profiling appends small JSONL records after each measured operation. Its overhead is not zero. CI comparisons need repeated observations before claiming an optimization gain; a local Mac is not a proxy for CI hardware. Full Playwright tracing is deliberately excluded from the full-suite measurement because it would add overhead; a targeted trace remains available for unresolved slow operations.

## Evidence and recommendations

Pending completion of the full local suite and unchanged CI job matrix with instrumentation. Raw synthetic execution artifacts remain in ignored run directories or CI artifacts rather than version control.

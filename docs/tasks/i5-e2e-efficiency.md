# I5: E2E coverage and execution efficiency

Status: in review
Branch: task/i5-e2e-efficiency
Depends on: D7 (PR #51)

## Goal

Reduce desktop regression latency without removing unique user-flow or safety coverage. Work in the original checkout; no worktree.

## Contract

- Audit all 43 desktop suites against the D7 baseline (153 cases). Record redundant cases and their retained assertion owners before removing them.
- Keep approvals, cancellation, restart recovery, deduplication, native boundaries, and integrated acceptance workflows in the default suite.
- Replace wall-clock scheduling waits with a due persisted schedule fixture, loaded only while the test Host is closed. Use the existing runtime store API; do not change production clocks, protocol or scheduling behavior.
- Bound file-level concurrency to two isolated background apps; keep each file's stateful cases sequential. Keep headed mode serial. Do not introduce retries or skip slow suites.
- Publish file/case timing data in CI so future regressions are attributable. Retain screenshots for distinct user states and failure diagnosis.
- Report measured before/after results from the same machine separately from CI timing.

## Acceptance

1. A coverage audit identifies every deleted case and the surviving checks.
2. The scheduler still runs real Host/executor/model work without Test run, publishes one missing-source result and preserves scheduled occurrence identity.
3. Full `pnpm run check` and `pnpm run e2e` pass; repeat the parallel suite to check isolation. Inspect changed-flow screenshots.
4. Record timing and counts, and upload machine-readable results with the existing CI screenshots.

## Verification

- Final `pnpm run check`: boundary and TypeScript checks pass; 507 tests pass across 77 files.

- Baseline D7 local full regression: 153 tests / 43 files, 510.14 seconds of Vitest execution.
- First optimized local full regression: 149 tests / 42 files, 232.30 seconds (54.5% shorter). All tests passed.
- Targeted migrated-coverage/scheduling run: 11 tests passed. The scheduled case takes about four seconds; no wall-clock minute wait remains.
- The periodic timer is independently verified with an advanced interval clock and real store I/O; no explicit sweep is called to make that assertion pass.
- Second full regression: 149 tests / 42 files, 230.38 seconds (54.8% shorter than baseline), with no retries or skips. Changed-flow screenshots for scheduled output, file/Markdown rendering and approved calculation/export were inspected.
- No native packaged release claim. No production code, timeout reduction, retries or skipped tests.

## Open questions

None.

## Main integration verification (2026-10-23)

Merged `main` at `0ebfc54` into this branch without rewriting history. Documentation conflicts preserve the current delivery scope and merged D7/B11b behavior. A merge-tree check also confirms compatibility with the updated research PR #45.

- `pnpm run check`: boundaries/types pass and all 513 unit/Host tests across 77 files pass.
- The initial parallel regression found one test race: Prompt validation sent Enter before the asynchronous profile editor closed and released the inert chat. The test now waits for the editor to disappear; no production change, timeout increase, retry or skipped coverage.
- The four memory-control cases pass independently. Isolated agent-browser exploration confirms profile save followed by the expected reply; the completed reply and scheduled/migrated-coverage screenshots were inspected.
- Final `pnpm run e2e`: all 153 tests across 43 files pass in 229.82 seconds of Vitest execution. These counts include the current main additions and are separate from the original D7 measurements above.

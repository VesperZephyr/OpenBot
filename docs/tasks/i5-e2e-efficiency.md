# I5: E2E coverage and execution efficiency

Status: in progress
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

## Open questions

None.

# I8: Complete CI Timings and Balanced Desktop Shards

Status: done
Merged: November 2, 2026 — [PR #79](https://github.com/VesperZephyr/OpenBot/pull/79), commit [`259b2ad`](https://github.com/VesperZephyr/OpenBot/commit/259b2ad6ce26ab2962bc2c290b5d0638464c466a)
Branch: task/i8-ci-timings
Depends on: I5
Architecture: verification tooling only; no product contract changes

## Goal

Measure the complete cost of each desktop test file and use comparable successful measurements to balance the existing free-runner shards without reducing coverage.

## Scope

In: a Vitest timing reporter, timing validation and aggregation, shard selection safety, CI summaries/artifacts, refreshed weights, and before/after acceptance.
Out: paid/larger runners, more Mac jobs, Linux migration, runtime behavior changes, test removal/skips/retries, relaxed assertions/timeouts, global isolation changes, dependency-cache redesign, and lint adoption (a following task).

## Design

The November 2 audit of 50 runs found that Vitest JSON file timestamps span test cases, excluding file-level setup/cleanup. Use the supported TestModule diagnostics to record execution (tests plus hooks), collection, setup, environment and preparation separately. Their sum is the recorded file cost; it is not workflow wall time or CPU utilization. Keep the standard assertion JSON alongside a versioned timing artifact.

Keep three desktop shards with two workers, and isolate history performance as today. Record a robust median of comparable successful samples for each file. Keep existing estimates for files absent from a partial sample, discard removed files, and give unseen files a median fallback. Refresh initial weights from a complete local run, then replace them with full CI measurements before comparing the final candidate. Do not merge mixed local/CI or OS/architecture samples.

## Contracts

- Timing format version 1 records environment identity (local/CI, platform, architecture), overall success and repository-relative suite paths, state and nonnegative finite component milliseconds. A module's execution includes beforeAll and afterAll. Interrupted/failed runs may publish diagnostics but cannot train weights.
- Input validation rejects unsupported/legacy report formats, malformed values, duplicate suite paths and incompatible sample environments. Weight recording is deterministic, order-independent, uses the median per file, and rounds to 100 ms with a positive floor.
- Selection discovers the actual e2e files, rejects unknown exclusions, invalid indices, duplicates, invalid weights and empty shards. All eligible files appear exactly once across shards. CLI failure must stop before Vitest, rather than expand an empty shell substitution into an unintended run.
- Keep all existing e2e assertions, screenshots, isolated data/Keychain services, default two-worker limit, history isolation and required gate behavior. Use only standard GitHub-hosted runners. Upload timings with existing artifacts; do not persist raw execution logs in the repository.
- Summaries distinguish complete file costs from test-case spans and workflow setup/build. Missing reports after interrupted setup are reported without inventing successful timing data.

## Steps

1. Claim this spec and open a draft PR with documentation only; retain that CI run as the unchanged-runtime baseline from main `1b550b9`.
2. Implement the reporter and safe recorder/selector, integrate summaries and artifacts, and test slow file hooks and malformed/failing inputs.
3. Run check and the complete background desktop suite; inspect screenshots and refresh local weights.
4. Run the instrumented CI candidate, download all shard/history timing reports, refresh comparable CI weights and run the final candidate. Compare queue, setup, build, check/test, total elapsed and coverage with the baseline, acknowledging sample size and runner variation.

## Acceptance

1. A real Vitest fixture with slow beforeAll/afterAll proves execution timing includes both hooks while the standard JSON case span does not; failed execution is not accepted as a weight sample.
2. Recorder tests cover median/order independence, missing/new/removed suites, invalid numbers/paths/versions, duplicate records and incompatible environments.
3. Selector tests establish complete disjoint coverage, invalid exclusion/index/weights and command failure before test dispatch.
4. `pnpm run check` and full `pnpm run e2e` pass; relevant screenshots are inspected. No existing tests are deleted, skipped or weakened.
5. Standard-runner baseline and candidate CI evidence names exact revisions/run URLs, reports coverage and timings, and does not equate a noisy sample with a guaranteed speedup. Unexpected failures are investigated rather than hidden with retries.

## Risks

File costs are summed worker components, not workflow wall time; parallelism and queue variation affect actual latency. CI report schemas are internal verification artifacts, separate from product persistence. A changed Vitest diagnostic contract must fail regression checks. Performance improvements are measured outcomes, not a required speedup percentage.

## Open questions

None.

## Evidence

[November 2 timing acceptance](../acceptance/2026-11-02-ci-timings.md) records the 50-run audit, exact baseline, CI calibration, successful weighted comparison and one investigated native screenshot failure. Review: [PR #79](https://github.com/VesperZephyr/OpenBot/pull/79).

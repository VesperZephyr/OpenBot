# E2E cost audit — 2026-11-02

Status: analysis complete; optimization proposals require their own implementation specs. [PR #85](https://github.com/VesperZephyr/OpenBot/pull/85) is a measurement spike, not a product optimization ready to merge.

## Conclusion

The critical path remains E2E execution, followed by dependency setup. Repeated application/Host startup is a material target. Screenshot capture and fixture directory/database preparation are much smaller costs. Four approximately five-second final closes also deserve lifecycle diagnosis, but their root cause is not yet established. Do not reduce screenshots, cases, recovery restarts, or isolation to obtain a faster result.

The instrumented CI completed in **275 seconds**, with **711 check tests and all 212 E2E cases across 54 files passing**. The unchanged warm-cache comparison run took 307 seconds. This is **not a demonstrated speedup**: this branch only adds measurement, and hosted-runner variation changes both file durations and the slowest shard.

## Evidence and method

Baseline: main at `f45a70728f2ce0012db9288cd5d6fe803614fa73`, after I8 and I9. Profiled revision: `b80a36b7a6f026e8ff3f18a100f2ffb372a75509`.

- [Instrumented CI 41405700692](https://github.com/VesperZephyr/OpenBot/actions/runs/41405700692): all required jobs succeeded. The four `e2e-screenshots-*` artifacts contain `results.json`, `timings.json`, screenshots, and per-worker `audit/*.jsonl` records.
- [Warm comparison 41392279691](https://github.com/VesperZephyr/OpenBot/actions/runs/41392279691): same tests and shard allocation, without the probes. [Calibration 41389603484](https://github.com/VesperZephyr/OpenBot/actions/runs/41389603484) and [main 41398945996](https://github.com/VesperZephyr/OpenBot/actions/runs/41398945996) provide additional file and setup observations.
- Full local background E2E: 54 files / 212 cases passed; Vitest wall time 335.21 seconds and pooled file execution 648.13 seconds. Local `pnpm run check`: 103 files / 711 tests passed.
- Existing synthetic timing fixture: its two 120 ms hooks measured 120.97 and 121.60 ms. Hook intervals are captured in the worker, avoiding reporter event batching.
- Targeted local diagnostics: artifacts/backups/bot-templates, 22 cases passed; targeted Playwright traces of routines/backups/chat-streaming, 18 cases passed. These additional diagnostic runs are excluded from the full-run aggregates.
- Inspected the CI PDF-reader screenshot and minimum-width Chinese routine-history screenshot. Both were captured and rendered; this audit does not claim a new visual acceptance baseline.

The opt-in `OPENBOT_E2E_AUDIT=1` probe records hook intervals and harness operations, without API arguments or results. It preserves all assertions, screenshot calls, timeouts, worker counts, state directories, Keychain isolation, and restart behavior. No production source or shard weights changed. Raw execution data stays in ignored run directories or CI artifacts, not version control. GitHub artifacts expire after 14 days under the existing workflow policy.

**Accounting:** CI job durations below are wall time. Operation and hook tables are sums across workers, including isolated history, and cannot be interpreted as seconds added to the workflow. Hooks contain startup, calls, and cleanup: do not add those tables together. `app.launch` ends when Playwright attaches; `app.firstWindow` and `app.sidebarReady` complete renderer readiness, **not Host readiness**. `HostProcess.call()` waits for `whenReady()`, so the first API call or UI setup operation may also include Host startup. The probe appends a small record after each operation; overhead is nonzero. Trace recording was restricted to diagnostic reruns because [full tracing adds overhead](https://playwright.dev/docs/trace-viewer).

## CI wall time

The runners reported 3 virtual Apple M1 CPUs, 7 GiB RAM, arm64, and Node 22.22.2. These match [standard GitHub-hosted macOS runner specifications](https://docs.github.com/en/actions/reference/runners/github-hosted-runners). No paid runner or service was used.

| Job | Queue | Setup | Desktop build | Check | E2E command | Job total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Desktop shard 1 | 4 s | 47 s | 17 s | — | 192 s | 265 s |
| Desktop shard 2 | 3 s | 29 s | 10 s | — | 130 s | 177 s |
| Desktop shard 3 | 3 s | 32 s | 14 s | — | 177 s | 229 s |
| Check + isolated history | 3 s | 36 s | 12 s | 108 s | 55 s | 217 s |

Totals also include summaries, artifact upload, cleanup, and gaps between steps. Workflow completion includes the final required gate. Shard 1 is critical in this run; shard 3 was critical in the warm comparison. A single run is insufficient to recalibrate weights or conclude that more workers will help.

All four jobs hit both caches. Setup-node took 14–25 seconds, installation 6–10 seconds, Pi restore 1–3 seconds, Electron download 2–3 seconds, and checkout 2–3 seconds. The pnpm store archive was about 128 MB; Pi output was about 2 MB. Logs show several seconds of archive extraction after download. [Setup-node caches package-manager data, not `node_modules`](https://github.com/actions/setup-node/blob/main/README.md). Optimizing install alone would miss the larger restore cost. Screenshot/report upload took only 1–3 seconds per job.

## Hooks and in-app work

CI file execution summed to **1004.1 seconds** in the existing timing reporter (1004.2 seconds with the independent worker probe). Collection/import summed to **28.5 seconds** and worker preparation to **1.0 second**. Thus disabling Vitest isolation to avoid module loading is not supported by this evidence.

| Hook | Calls | Pooled duration | Median | p95 |
| --- | ---: | ---: | ---: | ---: |
| beforeAll | 53 | 179.3 s | 2.62 s | 9.48 s |
| afterAll | 53 | 34.3 s | 0.20 s | 5.11 s |
| afterEach | 142 | 5.2 s | <1 ms | 116 ms |
| beforeEach | 4 | <1 ms | <1 ms | <1 ms |

Hooks total **218.8 seconds, 21.8%** of pooled execution. Most time is inside test bodies; those bodies also contain recovery restarts, polling, and intentional delayed responses. Hook count differs from file count because some files manage their app lifecycle in individual cases.

| Operation | Calls | Pooled duration | Median | p95 |
| --- | ---: | ---: | ---: | ---: |
| Electron launch / attach | 140 | 64.0 s | 327 ms | 1.77 s |
| Wait for first window | 140 | 44.8 s | 272 ms | 767 ms |
| Wait for sidebar | 140 | 42.0 s | 270 ms | 576 ms |
| Final app close | 57 | 33.7 s | 156 ms | 5.08 s |
| Close for relaunch | 83 | 20.8 s | 181 ms | 644 ms |
| Screenshot capture | 267 | 53.6 s | 129 ms | 565 ms |
| Shared UI Bot setup helper | 23 | 41.8 s | 1.72 s | 3.68 s |
| Explicit Host API calls | 3051 | 152.0 s | 7 ms | 74 ms |
| Renderer frame waits | 50 | 2.7 s | 35 ms | 213 ms |

The three renderer-startup phases sum to **150.8 seconds, 15.0%** of execution. There were 57 fresh app fixtures and 83 relaunches; additional internal Host restarts are not included in the Electron-launch count. Screenshots are **5.3%** and none exceeded 1.33 seconds. On the critical shard they sum to 20.6 seconds across two workers, so even eliminating them entirely could not remove more than that from its execution. All screenshots should stay.

Filesystem reset, fixture preparation, relaunch preparation, mock-model start/stop, and credential cleanup together sum to only **3.1 seconds**. History fixture seeding was 1.03 seconds; the rest of its 18.85-second beforeAll includes cold startup and index readiness that the performance acceptance intentionally measures. Reusing seeded databases would have little benefit and could weaken cold-start coverage.

### Specific slow paths

- `files.e2e.ts`: 63.18 seconds; beforeAll 9.39, afterEach cleanup 4.28, final close 2.06, screenshots 2.55. It is the largest file in this run, but capture itself is a small fraction.
- `history-scaling.e2e.ts`: 52.80 seconds; beforeAll 18.85, screenshots 0.91. Keep its isolated single-worker cold-index and performance assertions.
- `routines.e2e.ts`: 46.11 seconds. A targeted local trace places 17.84 seconds in the failure/edit/cancel case. Its scripted `Source service unavailable` response matches Pi's retry classifier even though HTTP status is 400; the default 2/4/8-second retry delays explain approximately 14 seconds. This is real retry-path work. The ScriptedModel comment claiming error responses are never retried is too broad. Do not change the error wording or disable retries just to shorten this case.
- `backups.e2e.ts`: 44.90 seconds. It exercises real close/restore/recovery cycles. A targeted trace shows multi-second waits for actual save/restore completion, not screenshot encoding.
- Streaming traces show waits of 2–4 seconds for deliberately delayed chunks, tool completion, and group completion. These exercise pending/streaming states and must not be collapsed into immediate responses.
- Final close took 5.07–5.40 seconds in backups, core-bot, themes, and coding-tools; all other final closes were below 2.1 seconds. A full local run had three comparable tails at different close/relaunch points. `HostProcess.stop()` has a 5-second forced-exit deadline, making fallback shutdown a strong hypothesis. A separate 22-case lifecycle diagnostic passed without reproducing the tails; no exit-signal evidence establishes the cause yet. Keep this distinction explicit.

A local diagnostic wrapper measured Host dependency imports at 612–899 ms (15 starts; median 683 ms), before opening the runtime. This supports investigating repeated import/startup costs but is not a CI import profile. An isolated local `NODE_COMPILE_CACHE` experiment did **not** show a benefit: three uncached imports had a median 697 ms, versus 904 ms for three warm-cache imports. The small, unpaired sample is not evidence of a general regression, but it does not justify enabling compile caching as an assumed improvement.

## Free-resource optimization proposal

Implement and validate one change at a time on separate spec branches. Recommended order:

1. **Profile and reduce repeated Host startup.** Split Host-ready latency into dependency loading, runtime/store open, executor readiness, and recovery/index work. Compare the current source entry with an E2E build reusing the existing runtime bundler in `apps/desktop/scripts/stage-runtime.mjs`, without downloading a second Node or packaging a DMG. Include the one-time bundle cost in CI wall time. Preserve all 140 app launches, per-suite state, custom Host/executor fixtures, fault injection, cold-index checks, backup recovery, and native credential paths. Extract/share build configuration rather than maintaining a divergent test runtime. Do not adopt the bundled path unless the complete suite passes and repeated CI runs show net benefit. This has a larger measured opportunity than screenshot tuning, but its gain is not yet quantified.
2. **Diagnose the five-second shutdown tails before changing lifecycle behavior.** Capture stop-phase durations and child exit codes/signals, including active work and pending observation/history requests. Reproduce the responsible await and add a focused regression protecting completed cleanup and persisted receipts. Repair that wait if confirmed; retain the safety deadline. Never replace graceful close with immediate kill, shorten timeouts, or label a forced exit successful cleanup. Removing the four observed tails would save roughly 20 pooled seconds, not 20 workflow seconds.
3. **Benchmark dependency restore as a whole.** Compare the current store cache, fresh frozen installation, and an exact-key installed-dependency cache. Measure restore + install + native build + cache-save cost, with both cold and warm runs. Any installed-tree cache must include root and workspace pnpm links, use OS/architecture/Node/pnpm/lockfile/workspace-manifest keys, validate native compatibility, and fall back to a frozen install on misses. Keep the small Pi cache. Do not add a large Electron cache to save a measured 2–3 seconds without a positive net benchmark. A desktop build cache is a later experiment only if its restore cost is below the existing 10–17-second build and invalidation includes runtime assets and native sources.
4. **Optimize setup interactions only after separating Host readiness.** The shared UI helper costs 41.8 pooled seconds, but some is waiting for the Host, so moving it to API calls cannot save all of it. For suites that merely need a Bot fixture, compare `h.api()` setup with the current helper; retain explicit UI creation/settings coverage and every final state assertion. Replace unnecessary polling gaps with observable readiness signals, while preserving retry attempts, delayed-state checks, and failure deadlines. No reduction in test cases or assertions is acceptable.
5. **Revisit scheduling last.** Keep two workers and the isolated history test for the first experiments. Three CPU cores already run multiple Electron/Host/executor processes. Only compare alternative worker/shard counts after collecting repeated CI samples, including queue time and the check/history branch. In this run that branch already takes 217 seconds, limiting the benefit of accelerating the desktop shards alone.

Keep all 267 captures, before/after cleanup hooks, required gates, and full per-PR coverage. No `isolate: false`, retries to conceal flakes, paid runners, or deferred nightly-only acceptance are proposed. The evidence supports incremental savings in startup/setup and tail latency; it does not support a 20× expectation.

## Acceptance for the next optimization

Use the same revision/test inventory and collect at least three baseline and three candidate warm-cache CI runs, plus one candidate cold-cache run. Report medians and ranges for workflow wall time, queue, setup, build, each shard, isolated history, and pooled startup/close/screenshot intervals; do not sum parallel work as wall time. Check both required-job results and the complete test inventory, and retain the existing shard-selection safety checks. Verify native module cache misses, restore invalidation, no orphan app/Host/executor processes, and unchanged background presentation. Refresh shard weights only from complete successful comparable CI reports after the final change. Any lifecycle or runtime-path change needs its own ready spec, full `check` and `e2e`, and relevant screenshot review.

Remaining limits: this audit provides one instrumented hosted run and one complete local run; the shutdown root cause and the net gain of any proposed optimization are unverified. No optimization has been applied or merged.

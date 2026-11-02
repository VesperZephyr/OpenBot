# I10 runtime prebuild acceptance — 2026-11-02

Status: controlled CI comparison complete; bundled default adopted. [I10](../tasks/i10-e2e-runtime-prebuild.md) owns scope and delivery status. [PR #87](https://github.com/VesperZephyr/OpenBot/pull/87) links the final candidate revision and its complete check/E2E result after the weight refresh.

## Implementation and invariants

The shared runtime bundler builds the existing Host, Executor, maintenance helpers, history worker and Code Mode worker, and stages QuickJS WASM/notices. Packaging retains its Node target and staging behavior. E2E targets checkout Node and selects the built entries only for ordinary Host launches and default Executors. The three explicit Host fixtures (history, web-feed and changelog-pagination) retain source entries and their patches. Offline backup helper selection is unchanged.

Missing generated entries/assets fail with a build instruction; source mode does not require generated files. Ten focused tests cover selection, explicit overrides and missing assets. No runtime product source, dependency, cache strategy, concurrency, required gate, test count, assertion, timeout, retry policy, screenshot call or restart step changed. One existing template fixture's renderer-clock setup was stabilized as described below.

## Local and packaging evidence

- At `b29386e609760c6a6cf0a97a22531d4be2f55330`, full check passed 104 files / 721 tests. Full background E2E at that revision also passed 54 files / 212 cases in 258.24 seconds, retaining 140 launches.
- Before the clock stabilization, the same implementation revision (`b568f289f0d9fc29728b4bce8b31a603374da303`) passed all 54 E2E files / 212 cases in both modes: source 332.46 seconds and bundled 265.83 seconds of Vitest wall time. Runtime build took about 1.6 seconds locally. This local pair is exploratory and is not the CI adoption result.
- The local source/bundled case inventories, per-suite launch counts (140 total), and 269 root PNG paths matched exactly. CI evidence also distinguishes 57 initial launches and 83 relaunches. The PNG inventory includes synthetic input images as well as captures; it is not a claim that screenshot calls increased.
- A standalone harness smoke test with no runtime-mode environment variable selected source Host/Executor and closed its isolated app. A default Vitest background-suite smoke test passed both cases and selected bundled Host/Executor for both initial launch and relaunch. This preserves standalone acceptance-script prerequisites while keeping the normal E2E command prebuilt.
- The shared Node 24 packaging build produced byte-identical output to the original configuration for all eight generated JavaScript/license files. The comparison used ignored/temp output; no release packaging, Node download, signing or publication occurred.
- Existing `verifyRuntime` passed against the generated runtime on checkout Node, using an isolated temporary stage and synthetic credential responses: real Host/Executor startup, backup export, removal of originals, restore, paused restart, history-worker generation, portable-template receipts and replay.
- A local historical-anchor dark-mode screenshot was inspected; the history search result, selected retained row, draft and navigation rendered. CI sample `41412864326` screenshots `code-management/01-nested-exact-approval-en.png` and `backups/02-restored-paused.png` were also inspected: exact approval details/actions rendered, and restored data remained visibly paused with its recovery notice.

## Baseline failures and fixture correction

The initial spec-only [run 41408050407](https://github.com/VesperZephyr/OpenBot/actions/runs/41408050407) failed template recovery at `clock.pauseAt(new Date())`, followed by dependent UI timeouts. It also observed `history-controls` reading completed instead of cancelled; that cause remains unconfirmed and its assertions are unchanged.

The source-mode warmup [41408764849](https://github.com/VesperZephyr/OpenBot/actions/runs/41408764849) reproduced the same clock failure. Sampling stopped rather than automatically retrying it away. The running renderer clock could overtake the timestamp sampled by the test process. The fixture now installs time slightly before a fixed target and pauses at that target before clicking Import, following the [Clock API's ordering guidance](https://playwright.dev/docs/api/class-clock#clock-pause-at). The original ten-query assertion and all recovery/restart steps remain. Both source and bundled targeted runs passed all seven template cases. Comparison restarts at `b29386e609760c6a6cf0a97a22531d4be2f55330`, with this identical setup in both modes.

The first, pre-correction bundled [run 41408703642](https://github.com/VesperZephyr/OpenBot/actions/runs/41408703642) passed all checks in 270 seconds. Runtime builds took 2–3 seconds per job. Its evidence retained 140 launches (137 built Host entries and three source fixture entries; 140 built Executors), 212 cases, 54 files, all 269 PNG paths, and active history counters. Pi output was uncached, so this run is exploratory rather than a matched warm sample.

Source sample [41413480505](https://github.com/VesperZephyr/OpenBot/actions/runs/41413480505) failed one case at the unchanged `always-allow` settings screenshot: Chromium returned `Page.captureScreenshot: Unable to capture screenshot` after the rule-presence assertion. All other cases/jobs passed except the required gate. Its 140 launches remain recorded, but `always-allow/04-rule-in-settings.png` and `05-card-back.png` are missing. Sampling stopped for log/code/artifact inspection. The capture's underlying cause remains unconfirmed; no screenshot, retry, assertion or timeout was changed. An additional complete source sample was requested explicitly after investigation, with this failed sample retained separately rather than included in successful-duration medians or shard training.

The targeted local source investigation failed earlier, waiting 30 seconds for the first command's success card; the next test then revoked the still-running command's permission and also timed out. This did not reproduce the CI capture error. During this investigation, spawning `/usr/bin/true` independently took 15,014 ms, showing local process-start latency outside the application. This diagnostic failure is retained; final full verification uses independent CI runners rather than interpreting this local run as a runtime performance comparison. The cause of the local process delay is not established.

After local process startup recovered, the unchanged source `always-allow` suite passed both cases in 4.13 seconds and generated all five screenshots. Full check at the final code revision `09d4e6128a73dd291e032fb331cc31e84c6d06c6` passed all 104 files / 721 tests in 32.85 seconds.

## Controlled CI comparison

All controlled samples use `b29386e609760c6a6cf0a97a22531d4be2f55330`, unchanged initial shard weights, standard public-repository `macos-15` runners, the same Node/pnpm pins, three desktop shards with two workers each, and one isolated history worker. Every macOS job in all six successful warm samples hit both pnpm and Pi output caches. No paid service or runner is used.

Seconds below come from GitHub timestamps. Workflow wall time includes queueing and the required gate; longest active job excludes its queue. Desktop columns include the runtime build step, including its source-mode no-op command overhead.

| Run | Mode | Result | Workflow | Longest active job | Desktop 1 / 2 / 3, E2E + runtime build |
| --- | --- | --- | ---: | ---: | --- |
| [41410305582](https://github.com/VesperZephyr/OpenBot/actions/runs/41410305582) | Bundled, warm 1 | Passed | 236 | 223 | 152 / 143 / 154 |
| [41410796913](https://github.com/VesperZephyr/OpenBot/actions/runs/41410796913) | Source, warm 1 | Passed | 329 | 318 | 174 / 170 / 242 |
| [41411540523](https://github.com/VesperZephyr/OpenBot/actions/runs/41411540523) | Bundled, warm 2 | Passed | 274 | 264 | 186 / 164 / 189 |
| [41412168792](https://github.com/VesperZephyr/OpenBot/actions/runs/41412168792) | Source, warm 2 | Passed | 300 | 279 | 195 / 186 / 184 |
| [41412864326](https://github.com/VesperZephyr/OpenBot/actions/runs/41412864326) | Bundled, warm 3 | Passed | 277 | 250 | 174 / 145 / 175 |
| [41413480505](https://github.com/VesperZephyr/OpenBot/actions/runs/41413480505) | Source, warm 3 | Capture failure, above | 372 | 361 | Excluded from success medians |
| [41414984011](https://github.com/VesperZephyr/OpenBot/actions/runs/41414984011) | Source, warm 4 | Passed | 332 | 310 | 164 / 191 / 234 |

The three successful samples per mode give these medians and observed ranges:

| Metric | Source | Bundled | Median reduction |
| --- | --- | --- | --- |
| Workflow wall | 329 s (300–332) | 274 s (236–277) | 55 s / 16.7% |
| Longest active job | 310 s (279–318) | 250 s (223–264) | 60 s / 19.4% |
| Slowest desktop E2E + runtime build | 234 s (195–242) | 175 s (154–189) | 59 s / 25.2% |
| Sum of three desktop E2E + runtime builds | 586 s (565–589) | 494 s (449–539) | 92 s / 15.7% |
| Pooled suite execution, all files | 1,167.6 s (1,130.3–1,172.5) | 969.6 s (888.4–1,063.8) | 198.0 s / 17.0% |

Per-job phase medians, seconds, preserve setup and check costs instead of attributing every difference to runtime selection:

| Mode / job | Queue | Setup | Pi + desktop build | Runtime build | Check | E2E | Finish | Active job |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Source / check + history | 6 | 36 | 14 | 1 | 129 | 68 | 7 | 270 |
| Bundled / check + history | 3 | 41 | 13 | 2 | 117 | 58 | 5 | 233 |
| Source / desktop 1 | 4 | 36 | 12 | 1 | 0 | 173 | 6 | 233 |
| Bundled / desktop 1 | 5 | 36 | 17 | 2 | 0 | 172 | 7 | 234 |
| Source / desktop 2 | 3 | 36 | 15 | 1 | 0 | 185 | 9 | 246 |
| Bundled / desktop 2 | 4 | 34 | 13 | 2 | 0 | 143 | 6 | 213 |
| Source / desktop 3 | 5 | 41 | 16 | 1 | 0 | 233 | 8 | 310 |
| Bundled / desktop 3 | 4 | 42 | 20 | 3 | 0 | 173 | 8 | 250 |

Phase medians are independent and need not sum to the job median; GitHub step boundaries also leave small gaps. Runtime builds cost 1–4 seconds per job. Pooled durations and their sums are work totals, not wall time. The recorded startup interval ends when the sidebar appears, not when all Host initialization completes, so it is not the adoption metric.

Every successful source/bundled sample has exactly the same 54 files, 212 case names, 269 root PNG paths, per-suite launch counts, and 140 successful starts (57 initial, 83 relaunches). Candidate evidence selects 137 bundled Hosts, the three original patched Host fixtures, and 140 bundled Executors. History worker guards/counters remain active and all existing performance bounds pass.

[Cold-restoration run 41415718686](https://github.com/VesperZephyr/OpenBot/actions/runs/41415718686) passed in 280 seconds, with a longest active job of 269 seconds. All four macOS jobs restored neither pnpm nor Pi caches and rebuilt Pi. Queue time was 3–13 seconds; setup 29–39; Pi plus desktop build 17–28; runtime build 2–3. Desktop E2E plus runtime builds were 129 / 162 / 191 seconds; check took 119 seconds and isolated history 66. It retained the same case, PNG and launch inventories. This disables pnpm and Pi cache restoration explicitly; it does not claim every OS/network cache is cold, and one run cannot establish the causal cost of caching.

## Adoption and remaining limits

Adopt the bundled default for Vitest E2E. Successful source and candidate ranges do not overlap for workflow wall time, longest active job, slowest desktop E2E-plus-build, or pooled desktop E2E-plus-build. The added build cost is included, complete inventories match, and cold restoration passes. Three successful samples per mode are operational evidence, not a guarantee for every runner. The failed capture sample remains a correctness/reliability limitation, not a performance sample.

Not every observed second is attributable to prebuilding: `check` runs before runtime selection and varied from a 129-second source median to 117 seconds in candidate samples. Desktop shard 1 barely improved while shard 3 improved substantially. The retained history fixture intentionally remains source-based. These limits argue for refreshing the weights and retaining the source recovery mode, not weakening performance bounds or moving assertions.

The final candidate differs from the frozen comparison revision in two operational details: standalone harness callers default to source while Vitest explicitly defaults to bundled (both comparison modes were already explicit), and `e2e/durations.json` is regenerated from all twelve complete reports across the three successful warm candidate runs. Every suite has three same-environment samples; no failed, source, cold or local timing trains the weights. The resulting desktop partition retains all 53 non-history files exactly once, with 17 / 18 / 18 files and estimated pooled costs of 310.1 / 313.8 / 313.1 seconds. History remains its own job. The final complete CI run linked from the PR validates these weights and mode defaults separately from the fixed-weight comparison.

The first post-weight qualification [41416986688](https://github.com/VesperZephyr/OpenBot/actions/runs/41416986688), at `09d4e61`, passed all three desktop shards (208 cases) and all 721 unit tests, but failed one of four history cases: warm-switch P95 was 500.405 ms against the unchanged 500 ms bound. The following search assertion was not reached; its recorded P95 was 708.477 ms, and the later controls P95 was 22.636 ms. The early failure prevented `history-scaling/01-long-history-group.png`; a diagnostic `history-scaling/failure.png` replaced it, so the total remained 269 PNG paths while the expected capture inventory did not match. All 140 launches remained. Workflow wall was 354 seconds, longest active job 310, and queueing 12–76 seconds across macOS jobs. This failed qualification is not included in successful warm medians or weight training.

Investigation confirmed that the isolated history job, source Host fixture, measurement code and limits were unchanged from the controlled comparison. Earlier successful CI samples recorded switch P95 values from 205.2 to 420.6 ms across both modes. A local single-worker recheck at the same final code revision passed all four history cases in 29.01 seconds. These observations are consistent with runner variance but do not establish the cause or fix the boundary failure. Preserve the 500 ms bound and every assertion, screenshot and retry policy; record an additional complete qualification run in the PR after this evidence-only update. A later green run is not proof that the intermittent failure is eliminated.

Shutdown tails and dependency-cache optimization remain deferred to separate scoped work. No owner-data app, paid runner/service, release or merge was used. Native release signing, permissions and packaged identity are not established by this test-build change.

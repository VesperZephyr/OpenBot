# I10: Prebuilt Host Runtime and Executor for E2E

Status: in progress
Branch: task/i10-e2e-runtime-prebuild
Depends on: I8 and I9 (merged)
Architecture: Sections 3 and 4; existing process, authorization, persistence, and packaging boundaries remain unchanged

## Goal

Reduce repeated E2E process startup by building the real Host Runtime and Executor once per test job, using the existing packaging configuration. Adopt the default only after complete CI comparisons demonstrate a net benefit including the added build step.

## Scope

In: shared runtime bundling and asset staging, an E2E-only build command, explicit source/bundled test modes, preserved custom fixture entry points, full-suite CI comparisons, and measured acceptance.

Out: lifecycle/shutdown fixes, dependency or build caches, paid services or runners, worker-count changes, new shards, test removal/skipping, assertion/timeout/retry changes, screenshot removal, shared application state, provider changes, vendored Pi changes, Node upgrades, DMG generation, signing changes, and production startup behavior changes.

The prior [measurement spike](https://github.com/VesperZephyr/OpenBot/pull/85) motivates this task; its [dated audit](https://github.com/VesperZephyr/OpenBot/blob/bcf8445d4a653fc9be655b7371425cd43562707c/docs/research/e2e-cost-audit-2026-11-02.md) is evidence, not an implementation dependency. Do not merge that instrumentation as a prerequisite.

## Design

Extract the runtime bundling implementation from `apps/desktop/scripts/stage-runtime.mjs` into one shared build module. Packaging retains its existing entries, Node target, Bedrock import adaptation, optional native externals, notices and WASM assets. E2E invokes the same module with the checkout's Node target and writes only ignored generated output. It does not download Node, package an application or acquire owner credentials. A build failure must fail the command; clear its own previous output before rebuilding.

The E2E harness selects the prebuilt Host and Executor through the existing unpackaged environment overrides. Every initial launch and relaunch uses the selected entries, with fresh suite state and unchanged Keychain/process isolation. Explicit environment overrides from the caller or fixture retain their current precedence. The history, web-feed and changelog-pagination Host fixtures remain source entries: their pre-start patches must affect the same runtime module instances as before. Their Executor may use the prebuilt default. Source-based offline backup helpers remain unchanged; their correctness and cost stay in the comparison. No production code is changed to bypass fixture hooks or force a faster shutdown.

Expose a source mode for controlled comparison and recovery. Missing prebuilt files/assets or an unknown mode fail with an actionable build instruction instead of silently falling back. Record selected entries and successful launch counts in ignored E2E evidence so source/candidate comparisons can verify fixture preservation and restarts.

Use only the current standard macOS runners, same Node/pnpm pins, two workers per desktop shard, and isolated single-worker history acceptance. Make CI comparison mode explicit through a manual workflow input; normal PR gates remain complete. Run source and bundled modes from the same implementation revision, with the same test inventory and initial shard weights. Freeze weights during comparison; refresh them from complete successful candidate CI reports after deciding to adopt, then rerun CI on the final weights.

## Contracts

- Preserve every existing E2E file, case, assertion, screenshot call, custom fixture, recovery restart and timeout. The initial inventory is 54 files / 212 cases; new focused verification may add coverage.
- Preserve original source-mode behavior and explicit Host/Executor override precedence. No switching custom patched Host fixtures to an unrelated bundled module instance.
- Build once per job, before tests; never rebuild in each test or application launch. No persistent cache or shared database is introduced.
- Packaging and E2E consume one implementation of bundle options and required runtime assets. Production entry paths, pinned Node, native identity and release staging remain unchanged.
- CI still runs check, all desktop shards, isolated history performance and the existing required gate. Neither source nor bundled comparison mode may skip suites to pass.
- The comparison includes queue/setup/check/desktop build/runtime build/E2E/finish and total workflow time. Report medians and ranges, cold/warm cache states, failures and raw run links; pooled worker durations are not workflow wall time.
- Shutdown and caching optimizations remain deferred until this task's result is known. Do not implement them as incident fixes or benchmark side effects.

## Steps

1. Claim this ready spec, push the task branch and open its draft PR before implementation.
2. Extract shared bundling without changing packaging behavior; add E2E build/mode selection and focused failure/override verification.
3. Verify generated Host/Executor and worker/WASM assets. Run full check and full background E2E; inspect relevant screenshots and compare case, capture and launch inventories.
4. Run at least three successful source and three successful bundled complete CI samples from comparable revisions/cache states, plus a bundled cold-cache sample. Do not discard failures: investigate and report them separately. Include every runtime build and keep comparisons independent of unrelated app changes.
5. Adopt bundled mode only if median E2E-plus-build and overall critical-path execution improve beyond the observed noise without correctness/performance-acceptance regressions. If inconclusive, retain source as default, record the finding and do not proceed to the deferred optimizations. Refresh weights only if adopted and validate the final candidate.

## Acceptance

1. Full `pnpm run check` and `pnpm run e2e` pass after final relevant changes. Existing source mode also passes the complete suite via CI. No case or assertion disappears.
2. Focused tests verify explicit overrides, missing builds/assets, invalid modes, and safe source selection. The generated bundle checks preserve optional-native boundaries and real Host/Executor operation.
3. Source and bundled runs have matching E2E file/case inventories, screenshot paths and successful app-launch/relaunch counts. History fixture guards/counters remain active; its performance bounds still pass. Credential, Code Mode, approvals, cancellation, backup/restore, unknown-effect recovery and restart suites remain green.
4. Shared packaging build options/assets retain the existing behavior; exercise the shared bundle and existing runtime verification using an isolated checkout Node without claiming release-signed or packaged native acceptance.
5. CI evidence identifies exact revisions, all sample run URLs, cache states, build overhead, timings and limitations. Source fallback remains usable. Adoption is an explicit evidence-based decision, not a conclusion from one faster run.
6. No owner-data app is launched; no paid runner/service, secret exposure, orphan audit process, release, or merge occurs.

## Risks

Bundling can break dynamic imports, worker locations, WASM assets and native fallbacks. History's prototype guards can silently stop applying if a fixture patches a different module instance; retaining its source entry avoids that change. A larger shared bundle can cost more to build/load than it saves. Standard-runner variance and branch cache scopes can overwhelm small gains. Node targets must follow each caller's actual binary rather than silently using the packaging pin in checkout tests.

## Open questions

None at design completion. Record dated findings here if the contract cannot be met; stop the affected work while continuing independent verification.

## Evidence

Pending implementation and CI comparison.

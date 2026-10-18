# B25: Local Read-Only Application Code Mode

Status: implemented, in review in PR #24 (stacked on #23); acceptance recorded below
Branch: task/b25-local-app-code-mode (based on B24 commit 510244a; PR #23 is not yet merged)
Depends on: B24; [D3](d3-app-capabilities.md)
Architecture: Sections 5.1, 5.10, 8.2

## Goal

Let Core compose authorized read APIs inside the already-vendored Pi QuickJS runtime, with bounded local intermediates, explainable nested activity, and recovery that preserves original authority.

## Scope

In: Core-only Code Mode, app read tools, discovery and stable prompt injection, structured results, bounded workers/bridge/output, original Run provenance, durable execution metadata, bilingual nested activity, bundled worker/WASM assets.
Out: management through scripts (B26), executor tools inside scripts, extra model calls, custom globals, raw IPC/SQL, remote sandboxes, recursive scripts, third-party packages and user-authored plugin installation.

## Design and contracts

D3's parent admission, leaf sequencing, initial resource table and privacy rules are normative. Reuse `createCodemodeExtension` and `CodemodeSandbox`; pass `models: false`, no `env`, no privileged globals. Keep existing direct tools model-only, app tools tools-only, and codemode model-only; test the actual `agent.callable` catalog rather than assuming namespace filtering prevents access. Specialist conversations never enable Code Mode. A group Core catalog is scoped to its current group's reads.

Extend Tool Router with orchestration admission through ports; do not acquire its conversation leaf mutex for the parent duration. Keep Pi top-level tool sequencing. Persist the original root Run/context once, and pass a trusted parent handle to children using Pi ancestry. Every leaf uses B24 gateway validation and the ordinary sequential router. Reject recursive invocation and parent-identity substitution.

`AppExecution` records live in Host-owned documents via agent-runtime: parent invocation ID, actor/conversation/Run/root request, target/scope, catalog and adapter versions, source digest, effective limits, admittedAt/deadline, state (`admitted`, `running`, `succeeded`, `failed`, `cancelled`, `needs_attention`), stable child metadata and terminal outcome. Generic logs exclude source/query/arguments/results. Pi remains owner of the VM replay journal; do not make a second result-delivery log. Record sufficient durable child metadata for completed activity, with no dependence on transient Pi task documents after settlement.

The sandbox wrapper enforces a 64 MiB heap, two workers globally/one per conversation until actual exit, 60-second absolute deadline, 64 leaf/128 total bridge requests, eight outstanding admissions, 32 KiB source/results and bounded final output per D3. Validate options before admission and enforce the effective deadline on actual VM start/replay. Reject excess calls before Pi creates unlimited child tasks; cancel the parent on hard resource violations even when script code catches errors. Keep query results in memory or local Pi task state; no automatic provider requests. Pi scratch storage follows its existing bounds and conversation scope.

No spill environment is installed. Truncation is explicit, with no bogus artifact path. The UI groups nested operations under a readable activity, shows waiting/failed/stopped status and preserves exact message navigation and approvals. Raw source is not the default product surface. Add all copy in English and Simplified Chinese.

## Required spike before ready

Use an isolated synthetic Harness and the pinned Pi version to prove:

1. Parent admission plus two nested app reads completes without either Pi's execution gate or Tool Router's leaf mutex deadlocking.
2. Stop propagates across VM, pending leaf queue and approvals; actual worker exit frees capacity. Infinite loop and output/allocation floods cannot stall the Host event loop or exhaust its process before rejection.
3. The sandbox adapter can enforce call/queue/output limits **before** unbounded allocation/task creation. Source options and discovery globals cannot bypass the limits.
4. Restart reuses original parent/child identities and deadlines, even when another Run is now active; changed fingerprint/version rejects replay. The Host scheduler's stop/recovery policy remains authoritative.
5. Worker module and QuickJS WASM load from an unpacked packaged app using bundled Node, without relying on the checkout/node_modules path.

Record concrete adapter APIs, assertions and results here. If Pi lacks a necessary hard-limit hook, design a minimal generic patch, add upstream-package tests and `OPENBOT_CHANGES.md` provenance, and update this spec before implementation. Do not work around a missing limit by exposing Node or by post-hoc truncation. The draft gate requests technical evidence, not an additional user permission prompt.

## Steps after the gate

1. Add adapter/ports and durable admission metadata in existing packages; wire packaged worker assets through the runtime boundary.
2. Install the Core extension and caller restrictions; generate declarations from B24 schemas with the 1,500-token initial namespace budget; reuse Pi discovery.
3. Implement safe result/error projection and bilingual durable nested activity. Add cancellation and partial read-failure behavior.
4. Extend ScriptedModel/e2e with composed search/read/filter tasks and fault injection; run full verification and update docs.

## Acceptance

1. Tests cover every spike invariant, unauthorized name/alias guessing, scope/Run changes, no process/require/fetch/import, disabled `models.*`, no recursive codemode and unavailable tools.
2. Unit/Host tests prove only final chosen output reaches the model; intermediate child results are local, content-free operation logs remain clean, and no unrestricted spill files appear.
3. Background e2e covers English/Chinese composed searches, nested activity, responsiveness under bounded faults, Stop and full restart. Existing direct Bot/group workflows remain intact.
4. Full check/background e2e and inspected screenshots pass; isolated real-model composed search succeeds with the configured provider. Compare complete direct/composed task usage and latency as observations, not a required percentage gain.
5. Build/package and exercise bundled worker/WASM loading. Report signing/native-permission limits separately.

## Open questions

None blocking. B24 is the explicit stacked base until PR #23 merges. B26 remains separate.

## Admission/limit spike design

The pinned Pi exposes `acquireWorker` (release on actual exit), deterministic `start`, tool-task ancestry through `getTask`, and `executeTool` stable keys. Its VM bridge has no configurable pre-post call/byte budget. OB-CODEMODE-1 adds optional generic bridge limits to pi-codemode: request count, tool count, outstanding calls, argument bytes, cumulative serialized output bytes/items, return bytes and scratch-write bytes. The VM latches a hard failure and interrupts on overflow before posting further messages, even when user code catches an error. Limits enter the deterministic fingerprint. OpenBot sets these options; upstream defaults remain unchanged.

The runtime adapter wraps Pi's existing extension/tool executor with Host admission and a per-execution sandbox. Parent and child identities are read from Pi task ancestry and a task-keyed durable application execution document, never parsed from generated source. Host admission calls the B24 authorization gateway through Tool Router without its leaf mutex. App tools become tools-only; existing work and management tools become model-only. Original parent provenance and a catalog/adapter digest are reused on replay. VM deadlines are clamped again at start. Durable child metadata records IDs, capability, argument digest and status, without retaining intermediate results twice.

A runtime-owned worker entry and WASM path are bundled alongside the Host; no Pi imports enter desktop or local-server. The spike uses synthetic data only. Its passing assertions enable the Core read-only extension.

## Spike evidence (2026-10-18)

- `apps/local-server/test/codemode.test.ts`: real Pi Harness + Tool Router + B24 gateway completes concurrent nested roster reads through sequential leaves, retains selected output only, rejects expired authority after a replacement Run, resumes a suspended child with its original ID/deadline and no repeated completed read, bounds pending floods, and stops an infinite VM.
- `packages/agent-runtime/test/codemode.test.ts`: adapter version/catalog/identity/deadline rejection and physical worker capacity.
- Pi bridge tests: loop/allocation/output/argument floods and caught errors remain bounded; Host timers keep ticking; worker slots release on actual exit. Existing durable Code Mode tests (47) preserve journal replay and model-disable behavior.
- `stage-runtime.mjs` bundles `codemode-worker.mjs` and copies `quickjs.wasm`/license. The staged Node binary executed the bundled worker from `/tmp` and returned `bundled-worker-ok` with no checkout module imports. Final packaged app validation remains an acceptance check.
- Adapter APIs are `getTask`, `agent.callable`, `memo`, `commit`, `createCodemodeTool`, deterministic `start`, `acquireWorker`, `onWorkerStarted`, and the traced OB-CODEMODE-1 generic bridge limits. The product source remains entirely in OpenBot modules.

## Implementation and acceptance

The runtime wraps the existing Pi extension and tool executor, without installing CodingTools or an unrestricted environment. The Host is the sole execution-document owner. Caller restrictions apply to the actual Pi catalog. Each nested call uses the original parent record and B24 gateway both before and after reading. A stopped or invalidated execution cannot be revived by a late completion. Parent metadata survives disposal of Pi task documents; live and completed child activity uses the same local projection.

Validation on 2026-10-18:

- `pnpm run build:pi` and `pnpm run check`: boundaries/type checks and 259 tests across 43 files passed.
- `pnpm run e2e`: 69 background tests across 21 suites passed. The composed-read suite additionally passed after final assertions for two model requests and one selected parent result. English/Chinese screenshots were inspected, including nested steps, denied reads, Stop and restart.
- Pi Code Mode: 227 Node tests passed, three Bun-only cases skipped using a Node-only PATH; the existing Bun process-exit failures remain documented in vendor provenance. Pi Durable Code Mode: 47 tests passed. Effective bridge budgets participate in replay fingerprints; omitted budgets preserve upstream fingerprints.
- `pnpm run package`: ad-hoc arm64 DMG built. Packaging now smoke-starts bundled Host/Executor from an isolated unrelated directory. JSONC uses its ESM entry because the UMD factory's relative require calls cannot be bundled. Worker/WASM/license assets load outside app.asar on bundled Node 24.22.0.
- Isolated real desktop with `mafia / gpt-6.1-sol`: English private-history composition, Chinese current-group composition, persisted execution metadata and real search/read after complete desktop/Host restart. The background desktop loads the final packaged Host/Executor/Node/worker/WASM through development launch overrides. No owner conversations or workspace were used. Installed-app UI/signing/native permission acceptance is not claimed; Developer ID/notarization remain unverified.

### Observed model cost and latency

One synthetic retained-history question was run with the same configured model and fixture using the direct B24 adapter and B25 composition. The direct reference used a separate copied local database and the same full tool catalog, with Code Mode disabled at the runtime port. This is a single observation, not a benchmark or a savings promise. Provider cache behavior and generated scripts affect the result.

| Whole task | Model requests | Uncached input | Cached input | Output | Reported total tokens | Wall time |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Direct search then read | 3 | 9,250 | 16,896 | 191 | 26,337 | 12.3 s |
| Code Mode composition | 4 | 11,546 | 29,312 | 1,023 | 41,881 | 29.8 s |

The composed run first discovered a declaration, then used a date regex that required a year and emitted no matching date. It corrected the script and returned the verified date and source IDs. Both composed scripts successfully performed authorized search/read; local VM execution was below 0.1 s each. Code Mode reduced neither model rounds nor tokens in this cold-discovery example. The scripted two-read composition uses two model requests and returns one selected tool result; intermediate reads remain local. Prompt/discovery efficiency and script quality remain follow-up product work.

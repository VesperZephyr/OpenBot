# B25: Local Read-Only Application Code Mode

Status: draft; do not implement the product rollout until the admission/limit spike below passes
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

## Risks and open questions

- The exact pre-allocation bridge/output limiting hook and any minimal vendor patch are unresolved until the spike. Pi's existing heap limit alone is not a bound on all Host allocations.
- Verify Pi nested sequencing and public parent ancestry APIs against the full integration; source inspection alone does not prove deadlock freedom.
- Do not mark this spec ready until B24 has landed or its exact stable contracts and the spike results are incorporated.

## Admission/limit spike design

The pinned Pi exposes `acquireWorker` (release on actual exit), deterministic `start`, tool-task ancestry through `getTask`, and `executeTool` stable keys. Its VM bridge has no configurable pre-post call/byte budget. OB-CODEMODE-1 adds optional generic bridge limits to pi-codemode: request count, tool count, outstanding calls, argument bytes, cumulative serialized output bytes/items, return bytes and scratch-write bytes. The VM latches a hard failure and interrupts on overflow before posting further messages, even when user code catches an error. Limits enter the deterministic fingerprint. OpenBot sets these options; upstream defaults remain unchanged.

The runtime adapter wraps Pi's existing extension/tool executor with Host admission and a per-execution sandbox. Parent and child identities are read from Pi task ancestry and a task-keyed durable application execution document, never parsed from generated source. Host admission calls the B24 authorization gateway through Tool Router without its leaf mutex. App tools become tools-only; existing work and management tools become model-only. Original parent provenance and a catalog/adapter digest are reused on replay. VM deadlines are clamped again at start. Durable child metadata records IDs, capability, argument digest and status, without retaining intermediate results twice.

A runtime-owned worker entry and WASM path are bundled alongside the Host; no Pi imports enter desktop or local-server. The spike uses synthetic data only. Product enablement remains gated until the assertions below pass.

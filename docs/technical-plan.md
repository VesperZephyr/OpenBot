# Technical Constraints and Known Gaps

This document owns cross-cutting limitations, non-obvious pitfalls, and unresolved technical decisions. Read code and tests for current implementation details. [Architecture](architecture.md) owns lasting design and trust boundaries; [task specs](tasks/README.md) own task status and delivery evidence; [backlog](backlog.md) owns the active queue. The [roadmap](development-roadmap.md) retains planning rationale, not current progress.

Update an entry when its constraint changes or evidence resolves it. Do not append completed-feature summaries, suite totals, or copies of type definitions. A dated observation is not proof that the same defect remains reproducible on every later revision.

## 1. Current State

### 1.1 Components

Implementation is described by the source and its tests. Use the [architecture module map](architecture.md#41-layout) to find the owning module and the [task index](tasks/README.md) to find a feature's design, status, and original acceptance. There is no separately maintained component-status table.

### 1.2 Known Gaps in Existing Code

These limitations are carried forward from delivery records; fixing or reclassifying one needs evidence in the responsible task.

| Gap | Where | Follow-up / evidence |
| --- | --- | --- |
| Scoped revocation stops supervised operations; arbitrary shell commands still run as the user and cannot be confined to a directory | `server-core`, `local-executor` | [Trust model](architecture.md#11-trust-model); isolated targets require a separate design |
| Desktop forwards a minimal environment: `$NAME` key references in `models.json` cannot resolve. Login-shell PATH discovery is implemented separately by B8a and does not import credentials | `apps/desktop/src/main/index.ts` | Before the first release: settle explicit credential references versus the documented Keychain / `!command` setup |
| B15a supports bounded text/images and plaintext HTML results; Office/PDF extraction, group input propagation, complete journal erasure and artifact maintenance are not implemented | `local-executor`, `agent-runtime`, Desktop | Separate artifact follow-ups |
| macOS notifications, dock badge, and power assertion are unit-tested as logic only | `apps/desktop/src/main` | Separate packaged native evidence; see [I2](tasks/i2-mvp-acceptance.md) |
| Finite feeds and date-only or modification timestamps do not establish complete release coverage | October 27 installed radar audit | B4a / #62 preserves bounded response continuation; I7 / #63 covers configured official-site pagination. Other source gaps remain explicit |
| History search scans the corpus; Pi active context and canonical group documents still scale with source data | `packages/agent-runtime/src/history-store.ts`, `groups.ts` | B14c bounds derived reads and renderer work. A canonical group migration or search accelerator needs a separate spec |
| Packaged native lifecycle event delivery remains unverified; B14b forwards and gates simulated events | `apps/desktop/src/main/index.ts` | Native release acceptance |
| HTTPS connectors require explicit Connect after failure/restart; idle GET notifications, stream resumption, OAuth and endpoint edits are not implemented | `local-executor`, Connect apps | Separate connector follow-ups |
| Developer ID credential identity and continuity across updates remain unverified; native evidence uses a separately sealed ad-hoc probe, not a release-signed OpenBot | `apps/desktop/native`, `scripts/verify-keychain.mjs` | Native release acceptance |
| Developer ID signing and notarization are wired but have never run | `.github/workflows/release.yml`, `apps/desktop/scripts/package.mjs` | First release |
| A crash between Pi conversation creation and the Bot-index commit leaves an orphan conversation | `agent-runtime` `createBot` | Runtime reliability follow-up; reconcile before proposing cleanup |
| A fixed 30-second request timeout applies to every Host method | `apps/desktop/src/main/host.ts` | Revisit when a long-running method appears |
| BYOK supports three APIs (`openai-completions`, `openai-responses`, `anthropic-messages`); there is no model discovery from a gateway's `/v1/models` | `agent-runtime/src/model-config.ts` | When a user needs another API or discovery |

Additional follow-ups remain outside existing contracts:

- Memory: bounded retrieval, semantic contradiction handling and source citations need separate design. Complete erasure from journals, backups and prior provider requests is not provided. See [memory research](research/memory-design.md), [B27a](tasks/b27a-memory-provenance.md) and [backup compatibility](tasks/b14d-backup-restore.md).
- Role composition: capability readiness, per-message skill overrides and broader group defaults require their own contracts; see [role research](research/bot-role-design.md) and [B27b](tasks/b27b-role-skills.md).
- Conversation and files: group pin/hide, manual mark-unread, Office extraction, relative HTML folder bundles and large-document virtualization are separate work. See [B14c](tasks/b14c-history-scaling.md) and [D9](tasks/d9-file-reading.md).
- Collaboration: cross-group dispatch, direct-chat peer collaboration and parallel model subagents are not implied by the existing group model; see [B13c](tasks/b13c-collaboration.md).

## 2. Pitfalls and Workarounds

Use **trigger/symptom → cause → workaround → regression/evidence → removal condition**. Keep local details next to the code or in their original task record; this section owns only cross-cutting findings and links. Remove resolved active-gap entries once their regression and rationale are preserved; retain dated acceptance as evidence.

### Code Mode deadline sampling

- **Observed:** D9 validation exposed an intermittent management invariant failure under load: a nominal ten-minute interval could measure 600001 ms.
- **Cause:** admission and deadline sampled `Date.now()` separately in `packages/agent-runtime/src/codemode.ts`.
- **Workaround:** no fix was included in D9. Preserve the deadline invariant; do not loosen it to hide the race.
- **Evidence:** the D9-era technical-plan gap records the observation; [D9](tasks/d9-file-reading.md) records its validation scope. This entry does not claim a fresh reproduction.
- **Resolution condition:** a runtime reliability task consolidates the clock sample and demonstrates deterministic deadline coverage; then close this gap.

### Timeline restoration and virtualizer measurements

[The B11e verification record](tasks/b11e-bot-routines-library.md#verification--october-29-2026) owns the trigger, root cause and failing-before/passing-after regression. Direct DOM scroll writes competed with virtualizer measurement/anchor correction after search jumps, resize and index rebuild. Keep restoration under the virtualizer's control and cancel it on user navigation. Any replacement must preserve those regression cases; do not infer final merge status from this note.

### Credential identity and native verification

[The B14e evidence](tasks/b14e-main-credentials.md) explains why an ad-hoc probe does not establish Developer ID credential identity or update continuity. Mocked permission events and background Electron checks cannot establish physical macOS event delivery or helper TCC attribution. The native release gates remain separate from automated acceptance; see [G0](development-roadmap.md#4-p0-closeout-and-dependable-execution).

## 3. Compatibility and Operational Obligations

- Persisted format changes need explicit versioning, old-data reopen/migration checks, backup scope, and rollback constraints. [B14d](tasks/b14d-backup-restore.md) owns backup/restore contracts; a new feature must account for its data rather than assuming existing backup coverage.
- Before a released protocol requires coexistence, `PROTOCOL_VERSION` remains `1` and all consumers change together. A release or independently upgraded consumer requires an explicit compatibility decision. Keep architectural implications in [Local Interfaces](architecture.md#6-local-interfaces) and exact schemas in source.
- Pi's experimental API and SQLite behavior depend on the recorded vendor/runtime versions. Check [vendor provenance](../third_party/pi/.openbot-vendor.json), [local patches](../third_party/pi/OPENBOT_CHANGES.md), and bundled runtime behavior before upgrades; do not infer compatibility from development-only tests.
- Test credentials use `MemorySecretStore` for package tests and dedicated `OPENBOT_KEYCHAIN_SERVICE` / `OPENBOT_DATA_DIR` for process checks. Remove test Keychain items afterward. Product diagnostics must exclude credentials and task contents; [privacy boundaries](architecture.md#local-privacy-and-operation-diagnostics) own that contract.

## 4. Operational References

Use [README setup and usage](../README.md), [AGENTS.md verification](../AGENTS.md#verification), and the scripts they invoke. Workflow-specific source choices and coverage limitations belong in [competitor radar](workflows/competitor-radar.md) and [official changelog pagination](workflows/official-changelog-pagination.md). Keep executable operations in scripts; document prerequisites, recovery and constraints rather than duplicating their commands here.

## 5. Open Decisions

| Decision | What remains to decide | Entry condition / owner |
| --- | --- | --- |
| Credential references at desktop startup | Explicit supported behavior for `$NAME`, Keychain and `!command`, without broad environment import | Focused credential follow-up; gap above |
| Runtime compatibility | Validate development and bundled Node compatibility against repository pins; do not maintain another version list in docs | Runtime or packaging update; `.node-version` and packaging configuration own versions |
| Signed updates | Artifact verification, credential continuity, migration failure and rollback policy; electron-updater/GitHub Releases is the planning direction | B14f requires its own ready spec; [roadmap](development-roadmap.md#6-p2-broader-access-and-maintainability) |
| Transcription | On-device only or optional configured endpoint; permission and privacy model | Phase 3 design |

Resolved choices belong to their original design records: [B1 receipt storage](tasks/b1-durable-approvals.md), [B7 IPC schemas](tasks/b7-desktop-mvp.md), [B4 search provider](tasks/b4-web-research.md), and [B14e credential ownership](tasks/b14e-main-credentials.md). Do not keep them in an open-decision checklist.

## 6. External Risks

- Commands run as the user; a directory grant is not an OS sandbox. Preserve the [trust model](architecture.md#11-trust-model) when changing policy or adding targets.
- Managed browser background throttling and native helper TCC attribution require feasibility evidence before their product specs. See [Phase 3 prerequisites](development-roadmap.md#7-p3-browser-desktop-and-demonstration-deferred).
- Stable Pi tool identities are required for replay safety. Vendor changes need the affected recovery tests and OpenBot receipt integration checks; the [Pi maintenance procedure](architecture.md#24-manual-synchronization) governs updates.

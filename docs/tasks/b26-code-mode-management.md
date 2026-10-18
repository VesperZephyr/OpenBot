# B26: Core Management Through Application Code Mode

Status: done; merged into main in [PR #27](https://github.com/VesperZephyr/OpenBot/pull/27)
Branch: task/b26-code-mode-management; pull request target: main
Depends on: B25, B18, B13b; [D3](d3-app-capabilities.md)
Architecture: Sections 5.3, 5.7, 5.10, 8.2

## Goal

Let Core compose existing Bot/group management operations through application APIs while preserving exact user approvals, Core protection, stable receipts and honest partial-completion status.

## Scope

In: inspect/create/update/delete Specialist and inspect/create/update/dissolve group aliases, shared domain handlers, per-child approval cards and local operation history, same authorization through legacy direct tools and Code Mode.
Out: auto-approval, grant/credential/policy changes, Core self-modification, group-origin management, cross-chat dispatch, other Bots' memory control, generic transactions and automatic rollback.

## Design and contracts

Expose `app_bots_inspect/create/update/delete` and `app_groups_inspect/create/update/dissolve` backed by the D3 capability IDs. Reuse existing management field schemas, expected revisions, generated object identities, proposal storage and atomic mutation receipts. Inspection returns revisioned editable state needed for a concrete proposal. Code cannot add actor/origin/target/grant fields or supply approval decisions. The aliases use the corresponding singular legacy tool schema (`bot_*` / `group_*`) without accepting extra properties. Inspection returns an array of profiles/groups; Bot writes return `{action,bot}` and group writes return the committed group, inside `AppResult`. All results have a 32 KiB serialized bound. An oversized committed result reports a resource error and retains its receipt; it is never retried under a new identity.

Only active direct Core user Runs may use these aliases. Core in groups and Specialists are denied at discovery and execution. Never promote a delegation, found message or code comment into user provenance. Keep current immutable Core lifecycle and management restrictions. No blanket management Always allow.

Prepare one bounded exact-change proposal per leaf; wait for the ordinary user decision; then re-check actor, original Run, local target, current policy, exact arguments, approval validity and target revision immediately before commit. No parent-script approval substitutes for leaf approvals. A denial terminates management admission for the parent, even if JavaScript catches the returned error. Cancellation/expiry stop future children; a revision conflict invalidates the proposal and requires fresh inspection/new explicit proposal.

Use the full stable nested invocation identity for idempotency and bind capability version/args/scope/target into its digest. Preserve existing mutation receipt atomicity. Completed receipts can be returned without changing state; mismatches fail. Unknown effect/termination marks `needs_attention` and blocks subsequent writes. Reconcile first; never claim exactly-once behavior from Pi replay alone.

Extend the absolute parent deadline to 10 minutes including approval waits and restart. Persist the deadline before execution; model options may shorten it. An expired card is visibly expired in both languages. Do not reset timeouts at each retry.

Scripts are sequences of committed operations, not transactions. If Bot creation succeeds and group creation is denied, keep the Bot, show its identity and the denied operation, and do not automatically delete it or retry the whole script. Durable parent/child activity survives Pi nested-result cleanup and Host restart. Legacy direct management aliases adapt to the same gateway/domain operation; do not create a second policy or approval path.

## Steps

1. Freeze alias/input/output mappings against implemented B24/B25; add strict descriptors and shared management service adapters.
2. Add direct Core-only scope and durable proposal/receipt bindings for nested calls; preserve legacy direct call identities.
3. Implement terminal mutation-admission latches, post-approval recheck, deadline and reconciliation behavior.
4. Project nested exact approvals, completed object links, partial completion/expiry and unknown outcomes into the existing bilingual conversation UI.
5. Run scripted fault matrix, full checks/background e2e, packaged regression as applicable, and isolated real-model workflow.

## Acceptance

1. Unit/Host tests: specialist/group-origin attempts, actor/parent/Run/target spoofing, Core deletion/modification, arbitrary settings/approval calls and stale discovery all deny without effect.
2. Tests inject crashes before proposal, while approval waits, after decision, after commit before result delivery, and after child completion before parent settlement; no duplicate Bot/group or reused approval with changed args.
3. Tests revoke authority/change revision/cancel while waiting, and catch a denied/unknown result in a script then attempt another mutation; no further write dispatch.
4. Background e2e: approved create/update/delete and group membership/dissolution, bilingual exact cards, denial and partial success, expiry, Stop and restart. Existing two-hop/twelve-delivery collaboration bounds remain unchanged.
5. Full `pnpm run check`, background `pnpm run e2e`, inspected screenshots and isolated real-model synthetic create-then-group workflow with exact recorded approvals; verify receipt/object counts after restart and clean only test-created resources.

## Risks and open questions

No open design questions. B25 supplies trusted nested ancestry and durable child metadata. The original management proposals and atomic domain receipts remain the reconciliation authority.

## Frozen implementation decisions

- Keep legacy direct tools model-only for compatibility. Register the eight `app_bots_*` / `app_groups_*` aliases as tools-only in the direct Core extension. Group Core retains only the five B24 reads. Both names enter the existing management domain handlers and exact approval book; preserve original names in approval/fingerprint records.
- Direct Core parents allow at most 600,000 ms, including approval; group parents retain 60,000 ms. Model options may shorten the original deadline. No approval restarts a worker or deadline. Child cancellation uses the parent deadline as well as the Pi context signal.
- Persist the parent execution ID and child digest in each management proposal. Check original Run, parent state, deadline, child digest and exact allow-once approval again inside the transaction that commits the mutation and receipt. Completed receipts are reconciled before any attempt to repeat a mutation.
- A failed admitted management child closes management admission for that parent. This conservative rule includes denial, revision conflict and Host-rejected invalid requests. Pi schema validation before admission may reject without creating a child. Unknown effects set `needs_attention`; successful earlier receipts remain visible. Read-only children may still explain completed work, but cannot reopen admission.
- Persist child outcome, receipt reference and resulting object ID/revision, without copying profile content into activity logs. Render nested approvals under their parent, using the existing exact-change card. Show partial completion, expiry and uncertain outcome in English and Chinese after restart.
- Test only isolated hidden Electron development shells. Never launch an installed packaged app for verification, because its production lifecycle does not honor the test background flags. Packaged runtime smoke tests may run without a GUI.

## Implementation and acceptance evidence

- Shared management descriptors derive from the original field schemas. All eight aliases use tools-only registration in direct Core, the existing domain handlers and exact approval records. Legacy tools preserve their names and invocation identities.
- Transactional guards bind child version/arguments, original user Run, parent, conversation and local target to an exact allow-once decision. Mutation receipts commit with Bot/group state. Receipt reconciliation retains successful object IDs when delivery fails after commit.
- The router persists management closure before releasing its leaf queue. This prevents already-queued `Promise.all` operations from racing a denial. The runtime also rejects later caught-error retries. Five suspended-Harness boundaries preserve child IDs and deadlines without duplicate effects.
- Durable child activity is observed independently of Pi conversation changes, including the first approval. English/Chinese cards show exact fields, partial completion, committed object references, expiry and Stop. Deleted objects retain their identity without a broken navigation button.
- `pnpm run check`: 278 tests across 44 files passed, including 18 management Code Mode tests. The matrix covers six approved mutations, inspection, rejection/queued retries, original authority spoofing, stale revisions, cancellation, changed approvals, uncertain delivery, receipt reconciliation, Core protection, expired approval and live projection.
- Full background `pnpm run e2e`: 73 tests across 22 files passed. The four B26 scenarios cover the full lifecycle, partial completion/denial, group-only read discovery, expiry/Stop and restart. A final targeted rerun verifies neutral action labels for rejected/expired steps after screenshot inspection.
- Isolated real-model acceptance used the locally configured `mafia / gpt-6.1-sol` endpoint. An English composed script created a Specialist and group with two exact approvals; after a full Electron/Host restart, a Chinese composed script updated both, dissolved the group and deleted the test Bot with four more exact approvals. The local journal confirms six consumed allow-once decisions, six distinct mutation child receipts, three Bot operations and three group intents. Restart preserved the original execution metadata. Only Core remains active; the dissolved test group retains its history.
- All app verification used isolated test state and hidden, non-focusable development Electron windows; window activity stayed false at approvals and completion. Screenshots were inspected for English/Chinese exact approval, expiry, partial completion and real-model completion. The agent-browser CLI did not retain its CDP target between commands, so Playwright CDP drove the same isolated app. The isolated app was stopped and its copied model configuration removed after acceptance.
- Runtime staging passed its bundled Node/Host/executor smoke test without a GUI. Production app bundles were never opened; native OS permissions and signed package behavior were not revalidated in this batch.
- Real-model cleanup exposed attempts to stop nonexistent conversations when dissolving a never-used group. Group lifecycle now stops only existing channels; a regression test covers unused and active groups.

## Remaining limitations

Code Mode sequences are not transactions and do not roll back earlier accepted changes. Direct Core parents have a ten-minute absolute deadline; groups retain sixty seconds. Changing the adapter/catalog version refuses unfinished incompatible scripts instead of migrating their execution. Exact proposals and Pi journals contain local user content; content-free activity keeps only IDs, revisions and status. Model inference still receives the requested task and selected output at the configured endpoint.

# B26: Core Management Through Application Code Mode

Status: draft; depends on B25 safety and recovery acceptance
Branch: unclaimed (expected task/b26-code-mode-management)
Depends on: B25, B18, B13b; [D3](d3-app-capabilities.md)
Architecture: Sections 5.3, 5.7, 5.10, 8.2

## Goal

Let Core compose existing Bot/group management operations through application APIs while preserving exact user approvals, Core protection, stable receipts and honest partial-completion status.

## Scope

In: inspect/create/update/delete Specialist and inspect/create/update/dissolve group aliases, shared domain handlers, per-child approval cards and local operation history, same authorization through legacy direct tools and Code Mode.
Out: auto-approval, grant/credential/policy changes, Core self-modification, group-origin management, cross-chat dispatch, other Bots' memory control, generic transactions and automatic rollback.

## Design and contracts

Expose `app_bots_inspect/create/update/delete` and `app_groups_inspect/create/update/dissolve` backed by the D3 capability IDs. Reuse existing management field schemas, expected revisions, generated object identities, proposal storage and atomic mutation receipts. Inspection returns revisioned editable state needed for a concrete proposal. Code cannot add actor/origin/target/grant fields or supply approval decisions. Freeze the final alias/schema mapping here when B24/B25 land.

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

The B25 trusted ancestry and durable activity schemas are not implemented yet. Freeze concrete mappings and recovery ownership after B25 acceptance. Keep this draft until then; do not weaken current management guarantees to enable a demonstration.

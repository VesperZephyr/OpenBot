# B12a: Deterministic Policy, Revocation, and Unattended Approval Expiry

Status: in review
Branch: task/b12a-deterministic-policy; pull request target: main
Depends on: B14b lifecycle gates (PR #31), B5 policy, B13c Run provenance, B24–B26 application authority
Architecture: Sections 5.1–5.3 and 8.1–8.2

## Goal

Let the user require confirmation for a narrow command or file operation, even when an existing allow rule would otherwise authorize it. A revoked permission must stop affected supervised work, invalidate stale approval authority, and leave unrelated work running. Approval from unattended work expires without extending its original deadline on replay.

B14b remains the owner of lifecycle stopping and interruption semantics. This branch inherits that prerequisite; its own commits implement only B12a. The PR targets main and depends on PR #31 being merged first, so the final review diff contains one task. No merge to main or release is performed by the execution agent.

## Scope

In: persisted Ask first rules, target and policy revision binding, exact approval fingerprints, current-policy dispatch checks, scoped revocation reconciliation, ten-minute unattended approval expiry, bilingual policy settings and result presentation, isolated verification.

Out: Auto Review/model reviewers, new blanket Allow rules, connector/URL predicates, browser/desktop grants, cloud policy, shell sandboxing, automatic retry of uncertain effects, routines and a new cancellation engine. Existing command defaults and Always allow remain available, with the new precedence and binding. Phase 3 OS permissions remain hard boundaries when those capabilities exist.

## Policy contract

The current local Host has one bound target. Policy and grant data carry that target and a monotonic authority revision. Existing local records are bound once during migration to the Host's current local target; records already bound to another target are not silently rebound. Workspace access remains an explicit application default for this target, not a removable user grant.

Every effective policy/grant mutation increments the authority revision in the same Pi transaction as the data change. Always allow saves its exact scope and the approval's resulting revision in one transaction. A read snapshot captures policy, grants and revision consistently. No model-supplied target, revision, origin or grant is authoritative.

Precedence:
1. Hard application authority: local target, tool/schema validity, live Bot/Run/channel and Core/management scope, file access/grant requirements, Commands Never and applicable executor checks.
2. Matching Ask first rules.
3. Existing explicit Allow automatically rules and folder grants.
4. Capability defaults, including the conservative read-only command heuristic.

A restrictive rule never creates a grant. A file outside grants still needs the exact one-off path or a user-chosen folder grant. Where an Ask first rule also applies, saving a broad folder/command allow does not suppress the next exact confirmation. Management proposals keep B26's exact approval and revision checks; ordinary policy never turns application authority into a blanket allow.

### Ask first rules

A rule has `id`, `targetId`, revision/creation metadata, optional `botId`, one tool, and one bounded predicate:
- `local_exec`: literal program with optional literal subcommand or exact normalized command part; optional canonical working-directory subtree. Match the existing conservative lexer, not a second shell parser. If parsing is ambiguous and a rule could apply within its Bot/cwd scope, ask rather than assuming a non-match.
- `local_read`, `local_list`, `local_write`, `local_edit`: canonical path subtree. The selected tool fixes read versus write intent.

No regex, arbitrary JavaScript, recursive expression language, wildcard tool family, or model-generated executable predicate. Maximum 256 Ask first rules, 4,096 durable policy request identities and 4,096 unreconciled/background operation records; saturation refuses new entries without discarding replay identities. Each string follows the existing bounded protocol limits. Command matching describes the parsed command line, not everything an unrestricted shell program might subsequently do.

New user-only methods create/delete Ask first rules using `requestId` and `expectedRevision`; retrying an identical create is idempotent, changed input conflicts, stale edits preserve the user's draft. Existing policy settings, command allow-rule deletion and grant methods share revision updates and restrictive-change handling. New rules are not exposed as model tools or application Code Mode capabilities.

## Approval identity and deadlines

An approval binds its stable invocation/call identity, Bot, conversation, trusted Run provenance, tool, local target, canonical argument digest and authority revision. Validate the complete binding on reuse and immediately before dispatch. A decision for changed arguments, another target, another Run, an expired deadline, or a revoked authority revision cannot authorize the call. A policy that independently allows a call may authorize it afresh; it must not be described as reuse of a stale approval. Deny remains terminal for that invocation, including Code Mode's management latch.

The Host determines origin from persisted Run/delivery records. Direct user messages and explicitly user-addressed group tasks are attended. Peer assignments, handoffs and result continuations are unattended. A missing/ambiguous trusted origin cannot be treated as direct-user authority. Future routine/background wake origins must opt into unattended treatment through their specs.

For a new unattended approval, `expiresAt = createdAt + 10 minutes`. Preserve its original creation/deadline on restart, replay and policy reevaluation. Effective expiry is the earliest of unattended expiry and an existing execution deadline. In particular B26's absolute Code Mode parent deadline must never be lengthened. Ordinary attended approvals without a parent deadline keep their current indefinite wait.

Expiry is durable and terminal: persist an expired outcome, remove the card, reject late clicks, settle the waiting tool with `approval_expired`, and do not dispatch. Runtime timers enforce expiry while waiting; startup reconciles elapsed deadlines before scheduling. Fake-clock tests cover the exact boundary. Recreating a withdrawn/expired record with the same invocation cannot reset its deadline or resurrect its authorization. Existing consumed results remain replayable without repeating effects.

## Dispatch and revocation

Application policy decisions are snapshots, not permanent grants. Recheck hard authority and deterministic policy after approval and after asynchronous grant preparation, immediately before host dispatch. Executor invocation carries the Host's current target-bound authority revision. A private policy synchronization envelope updates the executor's accepted revision before new dispatch; stale invocation revisions cannot start a new effect. A known terminal receipt can still reconcile the same invocation/digest without executing again.

A restrictive update follows a durable sequence:
1. Fence affected dispatch synchronously and persist the requested policy change plus a reconciliation intent. Fence updates and dispatch admission share one Host authority coordinator; it does not hold a lock for the duration of a command.
2. Reevaluate pending approvals, invalidating stale authority and updating exact visible choices. Do not reset deadlines or automatically approve a matching Ask first rule.
3. Identify affected active operations and background commands using their recorded tool/arguments/cwd, Run and permission provenance. Reuse B14b's interruption and supervised termination path with an explicit scope; never call global Pause all merely to revoke one folder/rule.
4. Synchronize executor policy, cancel affected operations, await scoped termination receipts, and persist reconciliation outcome. Unrelated operations continue. Lost acknowledgements or uncertain process termination stay visible as attention needed and keep affected authority fenced until reconciled.
5. On restart, reconcile pending restrictive-change intents before admitting affected work. Do not restore the deleted grant or blindly replay a command to discover what happened.

A file operation is affected when its authorized path loses the required access. A command can access more than its cwd; for cancellation, use recorded dependency evidence conservatively. If independence from revoked authority cannot be established, treat the command as affected. The spec and UI do not claim revocation rolls back an external effect or constrains arbitrary shell descendants. Tests must include both a demonstrably affected command and an unrelated operation that stays alive.

The executor retains invocation metadata needed to select foreground/background work; it must not expose command text or paths in operational audit events. Scope cancellation is target-bound, bounded, idempotent, and acknowledges only confirmed termination. B14b's global quiescence remains the all-work case of the same supervision mechanism. Scoped interruption adds a permission-revoked reason to the Run attention contract; Continue is unavailable until the relevant stop is reconciled and normal authority allows a fresh user follow-up.

## Desktop experience

Settings provides a clearly labeled Ask first section, current rules with Bot/tool/scope, a bounded rule form, and delete controls. Explain that Ask first wins over saved allows and that shell rules do not sandbox programs. Use the current visual components; preserve unfinished form input on validation/conflict. Folder revoke and allow-rule deletion show pending reconciliation, confirmed completion, or attention needed rather than optimistic success.

Approval cards show unattended expiry in ordinary language, preserve exact arguments, and disable decisions after expiry. Tool/task history distinguishes permission revoked, approval expired, denied and uncertain termination. English is the default; Simplified Chinese covers all new controls, status and errors. No native dialogs, notifications or focus changes are introduced. Folder selectors used by tests stay stubbed in the isolated hidden app.

## Implementation sequence

1. Add bounded protocol types/schemas, target/revision migration, atomic policy snapshots and exact approval metadata in the Pi adapter. Add transaction/replay tests before connecting UI.
2. Implement deterministic Ask first evaluation and shared authority coordination in server-core; keep application Core/group authority separate and stronger.
3. Add durable attended/unattended deadlines, runtime/startup expiry and stale-binding rejection to ApprovalBook; preserve B26 parent deadlines and denial behavior.
4. Extend B14b scoped interruption/quiescence with recorded permission dependencies and executor revision synchronization. Verify affected/unrelated work and recovery after lost acknowledgement.
5. Add bilingual settings/approval/attention UI and scripted desktop fixtures. Run check/full hidden e2e, inspect screenshots, and make one bounded real-model request proving an Ask first rule overrides an allow and revocation does not duplicate effects.

## Acceptance

1. Policy tests prove hard rules > Ask first > allow > defaults, strict target/Bot/tool/predicate bounds, legacy migration, idempotent creation, stale revision rejection and no grant creation through a rule.
2. Approval tests cover changed arguments/target/Run/revision, duplicate decisions, durable deny, exact Always allow scope, ten-minute unattended expiry with a fake clock, restart/replay without deadline reset, attended indefinite waiting and earlier Code Mode deadline.
3. Dispatch/executor tests inject policy changes while approval/grants resolve, stale policy messages, receipt replay, active and background revocation, unrelated-work preservation, executor loss and durable pending-reconciliation restart. No cancelled action is claimed rolled back.
4. Background e2e creates/removes rules in English and Chinese, overrides an allow, withdraws/invalidates stale approval, revokes during active work, preserves unrelated work, shows interruption/expiry, and reopens the same state without duplicate effects. Native pickers are stubbed; windows remain hidden/nonfocusable.
5. `pnpm run check` and full background `pnpm run e2e` pass; screenshots are inspected. A synthetic real-model check records actual execution receipts and file contents. Diagnostic logs contain identity/outcome metadata only; temporary credential configuration is removed. Packaged OS enforcement is not claimed.

## Open questions

None for this increment. URL/connector predicates and model review are separate batches. Revocation uses conservative operation dependency evidence and existing local supervision; it is not a new OS security boundary.

## Acceptance evidence

Implementation candidate: `cd12cd7` (2026-10-18); later changes only record this evidence.

- `pnpm run check`: 319 tests in 52 files passed, including authority, approval, store migration/replay, scoped revocation and executor invariants.
- `pnpm run e2e`: all 84 tests in 24 files passed in the isolated background app. The final targeted policy/collaboration rerun also passed all eight scenarios. Existing collaboration fixtures now resume intentionally interrupted work and use exact command allows rather than globally changing policy while expecting background work to survive.
- Policy screenshots inspected: English settings and exact approval; Chinese rules; scoped interruption with unrelated work continuing; revoked folder; unattended deadline and disabled expired controls. Native folder selection is stubbed. Renderer clock advancement verifies expired controls; Host fake-clock tests separately verify durable expiry and no dispatch.
- Bundled Host/executor startup passed with isolated local state.
- A real configured model in the hidden desktop requested a synthetic write under Commands Allow. A Core-scoped Ask first rule blocked it until exact approval. Adding a matching rule during execution revoked the Run; explicit continuation read the result. File and tool receipts proved exactly one initial write and no late effect. Rules and completed reconciliation survived restart. The window remained inactive, audit logs excluded task contents, and the temporary credential configuration was removed. Raw evidence stays outside Git.

All automated acceptance items passed. Native packaged lock/sleep/TCC/signing enforcement was not exercised and remains a separate release gate. Revocation confirms supervised termination where receipts permit; it does not undo committed effects or sandbox arbitrary shell programs. No Pi vendor baseline or dependency changes were made.

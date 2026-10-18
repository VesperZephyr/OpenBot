# I1: Integrated Product Foundation

Status: ready
Branch: task/i1-product-foundation; PR target: main
Depends on: D4 (#28), B14a (#29), B15a (#30), B14b (#31), B12a (#32), B13d (#33)
Architecture: Sections 3–6 and 8; prerequisite task specs remain authoritative

## Goal

Produce one tested local candidate containing observation recovery, artifacts, lifecycle control, deterministic policy and usage evidence before skills depend on their combined behavior. Resolve interactions between the reviewed increments without introducing a new product feature.

## Scope and delivery

The owner authorized uninterrupted sequential completion of the roadmap while away. Prerequisite reviews remain separate. Assemble them on this task branch with ordinary local merge commits; never merge to main, force-push existing task history, or publish a release. The PR targets main and lists its prerequisite PRs. Its reviewable integration commits implement only this spec. This is an integration gate inserted before B10 because independent changes overlap in application state, IPC and Run settlement. The roadmap's default merge-before-dependent-work rule becomes a local integration gate for this authorized queue; the owner still accepts and merges the delivered PRs.

In: combine the exact reviewed prerequisite heads, resolve conflicts preserving each contract, add focused combined regression tests, update status/dependency documentation and record candidate evidence. Out: new skills/routines/connectors, Pi updates, broad refactoring, changes to native verification authorization, automatic migration of owner data, and release publication.

## Contracts

1. Observation retains B14a stream identity, monotonic revision/cursor validation, gap recovery, bounded pull credit/backpressure and stale-child rejection. New artifact, lifecycle, policy and usage views must not bypass these guards or change read cursors through a background fetch.
2. Durable Run input identity includes B15a immutable ordered attachment references, original request text, channel and provenance. Admission still respects B14b gates and B12a current authority. A replay cannot rehydrate a different attachment, duplicate an accepted input, or create fresh permission authority.
3. Lifecycle interruption has intent and settled phases. B13d may freeze a terminal interruption's usage only after `interruption.settledAt`; before that it remains a live delta. Late committed provider-abort usage is included once. Repeated stop/revocation/restart cannot double-credit a Bot or charge a later explicit continuation to the old Run. Usage UI shows needs-attention distinctly from working.
4. Artifact import/export remains user-selected main authority; model publication remains an executor file-read operation under Tool Router. B12a revision fences, Ask first file predicates and grant revocation apply to publication's canonical source. Cancellation never claims rollback of an immutable copy already committed. Receipt reconciliation must return a verified committed artifact without rereading a now-missing or revoked source, and must never start a new publication under stale authority.
5. Executor private IPC preserves all three envelopes: artifact operations, lifecycle quiescence and revision/scoped revocation control. Every request validates the local target; replies are correlated to the current child and bounded by existing limits. Lifecycle stop does not acknowledge an old child or falsely complete an uncertain operation.
6. User-visible English/Chinese text, details panels, attachment cards, usage links and pause/revocation states coexist. Combined navigation expands folded tools, preserves drafts/accepted attachments, and retains Core-default group routing and private Bot chats.
7. No current-state documentation labels an unmerged PR done. The combined candidate lists exact prerequisite heads and keeps native release evidence separate from hidden verification.

## Steps

1. Save this spec before integrating. Merge the prerequisite branches in their delivery order, resolving overlaps from the specs and implementation tests rather than choosing one side wholesale. Record source heads and integration decisions.
2. Fix the interrupted-usage settlement boundary and prove its intent/settled/replay behavior using real Pi counters. Test a fresh continuation as a separate interval.
3. Exercise artifact publication under Ask first and grant revocation; verify authoritative receipts after source removal/restart and fenced stale dispatch. Preserve attachment admission/recovery through lifecycle pause.
4. Run all package boundary/type/unit checks and the entire combined hidden e2e suite. Add an integrated scenario that attaches a synthetic input, performs an approved artifact task, interrupts/reconciles work, reopens the result/usage and reconnects observation without duplicate effects. Native selectors remain stubbed.
5. Inspect English/Chinese screenshots and bundled Host/executor startup. Use one bounded real configured-model workflow with isolated state and actual file/receipt checks. Keep raw evidence outside Git and remove temporary credential configuration. Create an integration PR targeting main; then start the B10 spec from this verified candidate.

## Acceptance

- All prerequisite tests pass together; no capability or safety behavior is dropped merely to resolve a merge conflict.
- Interruption intent does not freeze usage; settled interruption and explicit continuation each have the correct deduplicated counters and truthful state.
- Approved artifact reads/publication, revocation, missing-source receipt replay and lifecycle pause preserve invocation and input identity.
- Observation reconnect and details navigation preserve draft/attachment/read state; no hidden verification window, notification, Dock badge, tray or power assertion appears.
- Full check/e2e, inspected screenshots, bundled runtime and isolated real-model evidence are recorded against the integration candidate. Native signing/TCC/power evidence remains a release gate.

## Open questions

None for this integration contract. Any incompatibility requiring a new externally visible contract must be recorded here before its design changes; prerequisite behavior cannot be silently weakened.

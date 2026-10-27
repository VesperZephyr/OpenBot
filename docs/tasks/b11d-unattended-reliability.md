# B11d: Unattended workflow reliability

Status: done (#60)
Branch: task/b11d-unattended-reliability
Depends on: I6, D10 (merged in #57 and #59)
Architecture: Sections 5.8 and 8.1; existing Host, Pi store and Executor boundaries

## Goal

Keep authorized daily work available through ordinary Mac usage and cosmetic edits, and contain individual scheduling failures without repeating uncertain effects.

## Contracts

- Lock state remains observable but does not block the currently supported non-interactive model/file/command/network/connector work. There are no model browser or desktop-input tools in this batch; future interactive control must gate on native lock state independently. Lock is not a sandbox for shell commands.
- Suspend immediately gates admission, aborts execution and reconciles supervised work. Only a successfully persisted, confirmed suspend transition can authorize automatic admission on wake. Interrupted Runs remain terminal and are not replayed. User pause, failed quiescence, legacy recovery requirements and quit recovery never auto-clear. Native source/sequence/epoch protections remain enforced, including user pause during wake.
- Add optional LifecycleRecord.autoResume, written only after successful suspend quiescence. Missing fields retain old conservative behavior. Automatic wake clears the scheduling gate, not the interruption records.
- Group.revision and Routine.revision remain optimistic edit versions. Optional Group.deliveryRevision and Routine.executionRevision bind report destinations and inputs; absent values fall back to revision. Only a name-only update preserves these semantic revisions. All other existing updates preserve conservative invalidation. Existing occurrences, captured inputs and published report identities are immutable across renames; ordinary edits still conflict against stale edit versions.
- Routine occurrence revision and report-input source revision mean execution revision; reportTo.groupRevision means delivery revision. Desktop editors use these values, falling back for old records. A name-only update does not cancel pending work or invalidate summaries. Existing disabled routines are not silently re-enabled.
- Reconciliation and due admission isolate each occurrence/routine failure. Retry with the original identities, exponential backoff from 2 to 60 seconds, and no speculative new invocation. A failed record must not block healthy tasks or Host startup. Global storage/preparation failures block that scan and surface health instead of being swallowed.
- Expose bounded, content-free scheduling fault metadata and last successful scan through routines.list. Fault metadata is process-local diagnostics, rebuilt by reconciliation after restart; durable execution records remain authoritative. Display actionable failure status in the routine panel. Clear recovered faults; never log prompts, report contents or raw provider errors.

## Steps

1. Implement lifecycle gates and native-event regression coverage.
2. Separate edit and semantic revisions; cover legacy state, pending work, rename chains, real configuration changes and restart.
3. Add isolated scheduling failure/backoff and visible health, with regression coverage for startup and recovery.
4. Run check and full hidden e2e, inspect screenshots, explore the background app using agent-browser.
5. Exercise the real Host/Executor processes with actual calendar admission, rename, native lifecycle events and a scoped failure injection. Perform a bounded real-model spot check separately, using isolated data and the configured provider without copying secrets into artifacts. No physical lock/sleep or owner configuration mutation.
6. Update architecture, plan and backlog; create a new PR targeting main. Do not merge or publish a release.

## Acceptance

- Lock/unlock preserves background work and does not create a resume requirement. Suspend/wake admits eligible new work only after confirmed quiescence; no repeated interrupted command. Explicit pause and failed stop remain blocked across restart.
- Group/source name changes preserve research and summary execution, even with pending work and after restart. Membership/workflow changes still invalidate dependent authority; stale edit versions fail.
- One broken occurrence or due routine cannot starve another; bounded retries and visible health clear after recovery. Failed global storage never authorizes work.
- Check, hidden desktop regression, screenshot review and process-level acceptance are recorded separately from the real-provider check and native OS-event limitations.

## Open questions

None.

## Verification (2026-10-26)

- `pnpm run check`: boundaries, type checking and 542 tests passed across 81 files.
- `pnpm run e2e`: 177 tests passed across 47 files. Coverage includes lock completion, suspend interruption without command replay, explicit pause/restart, rename-safe pending inputs, independent scheduling failures, backoff and repair.
- The new `unattended-reliability` desktop scenario uses actual Electron, Host and Executor processes with a scripted provider. Scheduled admission publishes both sources and the summary while an invalid peer schedule retries; all three reports are calendar occurrences, the summary has 2/2 inputs, and restart adds no duplicate reports or model requests. English and Chinese fault screenshots were inspected.
- `scripts/acceptance/unattended-reliability.mts` passed with the configured Opus 5.5 provider, isolated data and a maximum of eight inference requests. It used five requests, two successful official-source fetches, three completed scheduled group reports and 2/2 summary inputs. Rename happened during an actual inference request; the lock event remained active throughout reporting. Fault repair, automatic wake admission and restart deduplication passed. The group report, routine history and source-report links were explored with agent-browser.
- [Acceptance evidence and limits](../acceptance/unattended-reliability-2026-10-26.md). Physical OS lock/sleep, a full unattended overnight run, packaged identity/signing and the owner's complete monitoring roster are not claimed as verified. Owner configuration and the installed app were not changed.

Installed owner acceptance and the full eleven-source audit are recorded in [October 27 acceptance](../acceptance/radar-installed-2026-10-27.md).

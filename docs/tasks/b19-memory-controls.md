# B19: Bot Instructions and Memory Controls

Status: done (#12)
Branch: task/b19-memory-controls
Depends on: B18 (merged)
Architecture: Sections 5.1, 5.7, 8.3

## Goal
Make each Bot's instructions and learned memory understandable, inspectable and correctable without changing Pi's agent loop, compaction or thinking behavior.

## Scope
Profile Prompt editing, revisioned memory with bounded restore, provenance and empty-memory duplication. English is the default UI language; all new application text also supports Chinese. No shared memory, vector store, cross-Bot memory tools, templates or new orchestration.

## Design and contracts
- The profile editor labels user instructions as Prompt and explains that saved changes apply to the next model request, including the next tool round of active work. Profile saves send the revision loaded with the form. Stale saves fail and preserve the draft; reloading is explicit. Existing API callers may omit the profile revision for compatibility; the desktop editor always supplies it. Management tools retain B18's mandatory revision checks.
- Pi's configured instructions include a Host-owned profile revision marker. Configure and profile updates commit together; the persisted Pi request sections identify the revision actually used. Existing profiles are configured on open without changing their revision. Raw user Prompt stays unchanged in the profile. This records provenance without copying Prompt into operational logs.
- Current memory remains Markdown limited to 8192 UTF-8 bytes per Bot. Existing content-only documents read as revision 0 with source `legacy`; missing documents are empty revision 0. New fields are additive to the v1 document. Every accepted edit increments the revision, including clear/restore and same-content edits.
- A snapshot contains content, revision, source (`legacy`, `user`, `model`, `restore`), timestamp and optional restored revision. Keep the latest 20 previous snapshots, plus the current one. History is local; bounded UI history is not a database purge guarantee.
- User writes and restores require `expectedRevision`. The comparison, bounded history append and write are atomic. Conflict never overwrites either draft or current memory; the editor offers explicit reload and retains the draft until then. Restore is an explicit selection of a previous snapshot, creating a new revision. Clearing uses the same editor save path and can be restored while retained.
- `memory_update` requires the current `expectedRevision`, shown in the memory system section before each request. A stale call fails and asks the model to use the refreshed section. A Host-derived conversation/call identity binds a durable receipt to the Bot and edit hash; replay returns the committed revision without changing newer memory. Receipts store no memory content. Bots can edit only their own document through this tool, including the Core.
- Memory reads/history remain available for retained deleted Bots; writes reject deleted Bots atomically. A restore cannot read another Bot's history. Both Core and Specialists have independent Prompt/memory documents, not OS-level file isolation.
- Duplicate copies profile, Prompt and model settings, with empty memory/history. No selective memory transfer in this batch.
- The UI distinguishes Prompt from learned memory, shows source/revision/time, and previews retained versions before restore. It explains that clearing current memory does not erase chat history, local backups or prior provider requests. A new topic removes old conversation context while keeping current memory.
- All authoritative records stay in the local Pi store. Operational diagnostics record method/outcome metadata only. Configured inference receives the Prompt and current memory as task context; local storage is not offline inference.

## Implementation order
1. Add protocol snapshots/CAS and the local revision/history/receipt implementation.
2. Add Prompt revision binding, profile conflict handling and empty-memory duplication.
3. Implement bilingual inspection, edit, clear, history preview and restore.
4. Verify unit invariants, background e2e and isolated real-model flows; update current-state docs.

## Acceptance
- Unit: legacy content migration, independent Bot scope, concurrent user/model edits, stale profile saves, UTF-8 limits, bounded history, monotonic restore, deleted-Bot rejection and replay after restart preserve newer edits.
- Runtime: new Prompt and memory reach subsequent requests; reset, restart, model changes and compaction retain the right memory and profile revision.
- Background e2e: English/Chinese inspection/edit/clear/restore, conflict and draft preservation, fresh duplication, Prompt updates and local persistence. Inspect screenshots; no visible windows, focus changes or notifications.
- Run `pnpm run check` and `pnpm run e2e`.
- Real-model spot check: an isolated background desktop using the user's configured endpoint learns a synthetic preference, follows an edited Prompt, recalls memory after a new topic/restart, and reflects correction/clear. Never copy personal chat data. Remove the temporary credential configuration afterward.

## Risks and limits
Old facts can remain in active conversation context and retained storage after memory is cleared. History retains at most 20 prior snapshots in the active document; Pi's underlying journal, transcripts, backups and already-sent provider requests are outside that bound. An in-flight request uses its prepared context; changes affect subsequent requests. Pre-upgrade pending memory calls without an expected revision fail safely instead of overwriting newer memory; the model must use its refreshed memory section. No full-data erasure or cryptographic Bot isolation is claimed.

## Open questions
None for this batch. Selective memory transfer and data purge remain follow-ups.

## Implementation and verification
- `protocol` defines memory snapshots/history and required expected revisions for update/restore. `agent-runtime` owns atomic history writes, model receipts and revision-bound Pi instructions; `server-core` exposes the local methods and fresh-memory duplication.
- The desktop provides Prompt editing with draft-preserving conflicts, memory source/revision/time, explicit reload, clear-then-save, history preview and restore. English/Chinese application text and error messages use the existing local preference.
- `pnpm run check`: 200 tests across 31 files, including `memory-controls.test.ts`, Prompt request markers, reset/model changes, compaction and content-free operation diagnostics.
- `pnpm run e2e`: 40 tests across 15 suites, all background. `memory-controls.e2e.ts` covers user/model conflict, Prompt conflict, correction, clear/restore, restart, duplication, UTF-8 limits and Chinese conflict/recovery. Default-size English and minimum-size Chinese screenshots inspected.
- Isolated real Electron desktop on 2026-10-17, driven with agent-browser and CDP using the user's configured endpoint: model learned a synthetic tea preference through `memory_update`; edited Prompt took effect; new topic recalled memory; user correction replaced the preference; restart retained Prompt/memory; clear plus new topic returned UNKNOWN. The test used a private data/workspace directory, no personal chat data, and a temporary credential configuration removed after the app closed.
- No Pi vendor changes. Native permissions, packaged signing and notarization were not revalidated in this batch.

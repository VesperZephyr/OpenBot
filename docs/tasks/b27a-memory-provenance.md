# B27a: Attributable Memory and Explicit Sharing

Status: in progress
Branch: task/b27a-memory-provenance; pull request target: main
Depends on: B6/B19, D5; owner-approved D6 direction ([research PR #45](https://github.com/VesperZephyr/OpenBot/pull/45))
Architecture: Sections 1.1, 5.1, 5.7, 7.1 and 8.3

## Goal

Let the owner inspect where each memory note came from, correct or forget it without a stale model write undoing the decision, and deliberately share selected notes across Bots. Keep the application, memory and execution local. Model inference continues to use the configured endpoint.

## Scope

In: additive note metadata over existing local Markdown; Host-bound model-write provenance; owner correction protection; explicit owner-managed shared notes; bilingual note controls; existing Markdown/history compatibility; deterministic migration, concurrency, replay, scope and UI checks.

Out: semantic extraction/deduplication, embeddings, long-history recall, automatic sharing, group-owned memory, model-authored shared writes, background learning, full erasure, cloud services, role skill defaults (B27b), OAuth/model review and Phase 3. A note is one titled topic, not a claim of automatically identifying every semantic fact in legacy text.

## Design and contracts

### Local records and compatibility

Extend the existing `openbot.memory` document additively with optional note records. Existing content-only or B19 documents remain readable, and their original Markdown stays intact until an explicit write. A section headed by `##` becomes one note; a preamble becomes a legacy note. Migration attributes only the available snapshot source/time, never inventing a message source or extracting/sharing facts.

Each note has a stable ID, immutable normalized topic key, display heading, content, active/forgotten/shared status, original and last-change provenance, and owner-protection state. IDs and provenance come from Host code. A new model note uses a short specific topic; changing that topic requires an explicit owner operation, not an alias that overwrites another note. The Markdown `content` field is the projection of active notes after the first mutation, preserving B19 read/export compatibility; it is not a second independently writable store.

Retain the 8 KiB local active-content budget and twenty previous snapshots. Add a separate session-scoped shared-memory document with the same shape and a 4 KiB active-content budget. Cap each document at 128 retained note identities, including tombstones; never evict correction/forget protection silently. Quota exhaustion is an actionable error. Old snapshots lacking notes remain restorable as explicitly owner-authored content. Clear/restore are owner actions and do not promise erasure of chat, Pi journals, backups or provider context.

The new format is additive and retains the old Markdown and revision fields. Do not erase the legacy database or introduce a new storage engine. Reopen fixtures before and after migration; document that older application writers are unsupported once structured notes are edited. B14d must back up both documents and protection metadata together and expose restoration of earlier remembered state; this batch does not implement backup transport or claim that old backups cannot resurrect old facts.

### Sources, writes and correction

Model `memory_update` keeps its existing action/section/content/expectedRevision envelope. Append adds to a topic; replace updates/removes that topic. Every resulting note retains its original source and last-change source. A source identifies an owner edit, legacy snapshot, explicit restore, or a model write during a Host-bound Bot/conversation/Run/invocation. The latter identifies the learning context, not a verified claim that the user stated the note verbatim. Record source request IDs from the committed Run; do not accept provenance, Bot IDs or scope from model arguments. Retained references remain useful even if a Run projection is pruned; missing evidence must be labeled unavailable.

Only active direct user Runs may make new model writes. Group, peer, background and routine writes fail. The runtime rechecks originating Run/conversation and Bot identity in the same commit as the edit. Previously committed invocation receipts return their original revision without reapplying a change. Fingerprints bind all mutation arguments and provenance identity; stale expected revisions fail before writing. New calls cannot use receipt replay to write into another Bot.

Owner edits, clears, forgetting and restores protect affected topic identities against subsequent model append/replace, even if the model has refreshed the revision. A model can add a distinct topic but cannot overwrite a corrected/forgotten topic. Explicitly shared topic keys also block model writes to the same local key. Semantic aliases are not detected; prompt guidance must favor owner corrections and forbid recreating a forgotten fact under another title. This batch claims identity/revision protection, not semantic contradiction detection.

### Explicit scope

The owner can create/edit/forget notes in either This Bot or Shared across Bots, and move a local note into shared memory or back to the selected Bot. Scope changes require a concrete review showing content and audience before the write; they never happen because a model says a fact is global. An atomic move updates both documents, preserves provenance and leaves a protected source tombstone. An existing destination topic causes a conflict instead of replacement. Both document revisions participate in scope-change CAS.

Shared notes apply to direct chats and routines, not group conversations. Existing Bot-local memory continues to apply across that Bot's contexts, preserving B13a behavior; the UI states this clearly. A shared active topic takes precedence over the same local topic in direct/routine prompt projection; the local entry remains visible in the editor as overridden. A forgotten shared topic also suppresses matching local content; moving it back to one Bot explicitly ends this suppression. Groups omit shared content and retain only their existing Bot-local projection. This is model-context scoping, not isolation between Bots on the shared Mac.

### Application API and UI

Keep `bots.memory.get/update/restore` for local Markdown/history compatibility. Add typed shared get/update/restore methods and a note mutation method for add/edit/forget/share/unshare. Mutations include a stable user request ID and expected document revision; scope moves also include the other revision. Receipt and state commit atomically; changed arguments under the same request ID fail. UI drafts survive conflicts, and retries never silently adopt a newer revision.

The Memory tab offers note cards with topic, current content, scope, original/last-change source and owner protection. Source inspection shows attributable request references and a bounded source preview from authorized local conversation history when available, not arbitrary filesystem reads. The existing Markdown editor and snapshot preview/restore remain available. Sharing presents the exact note and audience in a review step; editing or forgetting shared notes clearly says it affects all Bots' direct chats and routines. English and Chinese controls fit the existing small-window dialog.

Prompt guidance distinguishes facts from permissions and live external state, names protected topics, states scope and asks the model to use current sources for changing data. No note may grant a permission or rewrite standing role instructions.

## Steps

1. Add the typed note/source/state and application schemas, then pure conversion/projection/change helpers.
2. Extend runtime documents and atomic mutations, receipts and bound provenance; integrate Host methods and routed model writes.
3. Render scoped prompt sections and update memory/tool guidance.
4. Add bilingual note/source/scope controls while preserving B19 Markdown/history behavior.
5. Add migration, source authority, correction/replay, shared-scope and failure tests; extend hidden desktop e2e and inspect the running isolated app.
6. Run `pnpm run check` and `pnpm run e2e`, inspect screenshots, update architecture/current-state/backlog and submit the PR. Keep B27b on a separate branch/spec after this acceptance passes.

## Acceptance

1. Legacy Markdown and B19 history remain readable; migration/reopen preserves text and available attribution without auto-sharing. Quotas and failed changes are atomic.
2. Model writes bind the real direct user Run; forged provenance, cross-Bot calls, group/routine/background writes and stale revisions fail. Sources are inspectable after restart.
3. Owner correction/forget protection survives refreshed model revisions, original invocation replay and restart. Snapshot restoration is an explicit owner action; semantic-alias and backup limitations are documented.
4. Shared moves are atomic and revision checked; another Bot receives shared content but not the source Bot's unrelated notes. Groups exclude shared content; routines include it. Model writes cannot change or shadow shared topic keys.
5. ScriptedModel e2e covers learning/source inspection, owner correction, blocked overwrite, share review/cancel/confirm, second-Bot context, conflict-preserved drafts, forget/restart, English/Chinese and a small window. Existing local Markdown/history controls remain checked.
6. Full check/e2e pass, screenshots and agent-browser exploration of an isolated app are recorded. Scripted behavior proves state and context contracts, not real-model memory accuracy.

## Risks

Topic-level notes can contain several claims; provenance names the learning operation, not an automatically verified original document citation. Owner protection prevents automatic updates to that topic, so the Bot must explain that the owner can edit it. Shared facts add bounded context and may conflict with legacy notes; the prompt projection and UI must agree on precedence. Retained old conversations can still contain superseded facts. All Bots share the Mac; scope filtering is not an OS sandbox.

## Open questions

None for this batch. Semantic aliases, finer source citations, retrieval, broader context scopes, background extraction and backup transport remain separate work.

## Verification record (2026-10-22)

- `pnpm run check`: 490 tests in 73 suites; boundaries and both TypeScript projects passed.
- Focused hidden desktop acceptance: 7 tests in `memory-controls.e2e.ts` and `memory-provenance.e2e.ts`, covering legacy history, real routed learning, source previews, protected correction, conflict-preserved drafts, reviewed sharing, a second Bot, forgetting/restart and Chinese small-window controls.
- Runtime coverage checks matching shared-topic precedence, forgotten shared-topic suppression, direct/routine/group context differences, cross-Bot and non-user rejection, bounded source unavailability after pruning, durable replay, quota rollback and legacy reopen.
- Full desktop regression and final focused build are recorded below when complete.
- Inspected `e2e/.run/memory-provenance/` screenshots. Used agent-browser over CDP on the isolated hidden `memory-explore` app to open the Memory tab, review/confirm a scope change and inspect the resulting shared note. Inspected its screenshot and shut down that test app. No owner data was opened.
- These deterministic tests establish authority, state and prompt-input contracts. No real-model recall/semantic accuracy benchmark or packaged native release validation was performed in this batch.

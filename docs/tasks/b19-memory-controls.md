# B19: Bot Instructions and Memory Controls

Status: draft
Branch: task/b19-memory-controls
Depends on: B18
Architecture: Sections 5.1, 5.7, 8.3

## Scheduling
Deferred. The current product increment retains Pi execution, context, thinking and the existing per-Bot memory document/editor. Revision history, conflict handling and new memory orchestration need separate acceptance before this spec becomes ready.

## Goal
Make independent instructions and learned memory understandable, inspectable and correctable.

## Scope
Profile/Prompt/memory/model controls, revisioned memory with bounded undo, explicit provenance and empty-memory duplication. No vector store or automatic shared user-memory layer.

## Design and contracts
Retain the 8192-byte per-Bot document. Add monotonic revision and source metadata; user edits and model section edits use expected revisions. Conflicts reload rather than overwrite. Track instruction revision used by each request. Every memory edit remains local and is visible; diagnostics exclude its contents. Clearing memory does not promise erasure of history, backups or remote provider requests. Templates/copies exclude learned memory and history by default. Cross-Bot corrections require Core authority and a user task.

## Steps
1. Finalize migrations and revision/history bounds.
2. Add atomic conflict checks and tests.
3. Update editor, memory activity/undo and duplication.
4. Test restart, compaction, new topics and model changes.

## Acceptance
Unit tests prove per-Bot scope, concurrent edit safety, byte limits and undo revision behavior. Background e2e proves inspection/edit/clear/undo and empty-memory duplication; check passes.

## Risks
Old facts may remain in conversation context after deletion from memory; make this visible.

## Open questions
Set history retention and selective context transfer before ready.

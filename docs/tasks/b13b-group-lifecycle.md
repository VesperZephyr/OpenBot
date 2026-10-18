# B13b: Group Lifecycle

Status: implemented, in review
Branch: task/b13b-group-lifecycle
Depends on: B13a, B18
Architecture: Sections 5.7, 6.5, 8.3

## Goal
Let the user and Core create and manage groups of existing Bots. Members execute user-assigned tasks in separate group contexts. Automatic peer handoffs belong to B13c.

## Contracts
- Persist groups, append-only posts, deliveries and management receipts in the local Host-owned Pi store. No cloud group service. Model inference receives the selected group's task context; diagnostics contain identifiers and outcomes, never message bodies.
- A group has a stable `group_` ID (never the reserved direct channel), name (1–100 characters), objective (up to 4,000 characters), two to six unique live Bot IDs, one member as lead, a revision and active/dissolved status. Core membership is optional. Groups never create Bots automatically.
- The local user can create, edit and dissolve through desktop. Only the persisted Core in its direct conversation, on a running user-origin Run, receives group management tools. Every model-selected mutation requires an exact Allow once confirmation. Specialists and Core in group contexts have no management tools or authority. Prompts, names and tool arguments cannot grant it.
- Updates and dissolution require the current revision. Creation and mutations are replay-safe by stable request identity. Reusing an identity with different arguments fails. Validate live membership and revision again at the atomic mutation, after approval.
- Each user post binds explicit recipient IDs from a member picker, or defaults to the lead. Each recipient gets its own durable delivery and separate Run in the group's channel. No inference of recipients from model prose or mentions. Replies have immutable originating group, sender and user-post IDs. Bot replies do not wake other Bots.
- Task input includes the group objective and bounded recent public group posts, never private conversations. Prompt and memory remain shared per Bot. Each delivery records the exact input before admission so retry cannot change it. One running Run per Bot still applies.
- Delivery acceptance precedes scheduling. Stable delivery request IDs deduplicate the crash window between scheduling and recording the Run. Completion and reply publication are atomic. Restart reconciles unfinished deliveries without publishing twice.
- Membership removal cancels that member's outstanding deliveries. Dissolution cancels all group work, prohibits new posts and retains read-only history. Invalidated deliveries never revive on re-add. Bot deletion removes membership; losing the lead or falling below two members pauses new posts until repaired. Other groups and direct tasks remain intact. Cancellation does not undo external effects.
- Group task approvals retain the actual channel conversation identity. The group view exposes approvals and stop controls. Opening a group never switches a Bot's private transcript to the group context.
- English is the default; all new controls, confirmation summaries, empty states and application errors support Chinese. Background e2e remains hidden and silent.

## Implementation sequence
1. Public group contracts, atomic local records and receipt/delivery invariants.
2. Host lifecycle, channel scheduling/recovery, Core policy and handlers.
3. Sidebar, group transcript, recipient picker, membership editor, approval and read-only states.
4. Invariant tests, background e2e, isolated desktop exploration and synthetic real-model spot checks.

## Acceptance
- Unit: invalid membership, stale revisions, replay conflicts, authority and exact approval, removal/dissolution, Bot deletion, stable publication and recovery.
- Background e2e: create/edit, default lead and explicit recipient routing, independent private history, approval/stop, member removal, dissolution and restart; English/Chinese and small-window screenshots.
- Real model in an isolated background desktop: Core proposes group changes through routed tools and exact confirmations; members answer group tasks; dissolution is durable.
- `pnpm run check` and `pnpm run e2e` pass; inspect screenshots. Update technical plan/backlog and report automated checks separately from real-model checks.

## Open questions
None. Automatic peer handoffs, autonomous group conversations, attachments and transcript purge are deferred. Retained group history remains local; this batch does not add a cloud sync or a per-Bot filesystem sandbox.

## Verification
- `pnpm run check`: 211 tests across 35 files, TypeScript and package boundaries pass.
- `pnpm run e2e`: 45 tests across 16 suites pass in background mode. Group coverage includes desktop creation, draft conflicts, lead/selected-member routing and multi-recipient fanout without peer wakeups, private-context exclusion, exact Core approval/restart, scoped stop/removal, dissolution, and repairing a deleted lead. English/Chinese and small-window screenshots were inspected. The five group scenarios were rerun after final copy and fanout coverage changes.
- Runtime recovery tests cover the crash window after a completed Run but before its delivery receipt, duplicate publication, and dissolution committed before active-task cancellation. No model resumes for the invalidated task.
- Real-model spot checks used a separate background desktop with synthetic Bots and tasks: Core created, updated and dissolved a group through actual routed tools and exact approval cards; the lead answered a fictional arithmetic task and a selected member reviewed it in Chinese. A desktop restart preserved both Bots and all four posts in read-only history. The temporary model configuration was removed after verification.
- Native packaged-build permissions/signing were not changed or revalidated in this batch. Automatic peer handoffs, transcript pagination and complete historical-data purge remain follow-ups.

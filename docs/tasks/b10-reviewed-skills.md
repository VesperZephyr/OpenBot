# B10: Reviewed Reusable Skills

Status: in progress
Branch: task/b10-reviewed-skills; PR target: main
Depends on: verified I1 candidate `63fb9bc397e9cbfeba30df95e73d3a1e63bc6f34` (#34), including #28–#33
Architecture: Sections 3, 5.3, 5.8, 6 and 8

## Goal

Let the user turn a successful task into a reviewed local procedure and reuse its exact version with another Bot. Skills contain guidance, never executable extensions or permission grants.

## Scope

Shared local library, structured metadata, canonical SKILL.md, list/load, reviewed creation/update/deletion, version history and immutable message attachments. A library panel and composer selection work in English and Chinese. Reuse Pi Durable prompt sections, tool tasks, sequential invocation, durable submissions and cancellation through agent-runtime. No Pi update, CodingTools, arbitrary bundled scripts, marketplace, connectors, routines, demonstration capture or new Code Mode bridge.

## Contracts

### Data and ownership

- `SkillDocument` has a lowercase ASCII slug `name` (1–64 characters, letters/digits separated by single hyphens), `description` (1–300 characters), and nonempty text fields `inputs`, `requirements`, `steps`, `validation`, `output`, `approvalBoundaries`. A field may explicitly say “None”. Each procedure is at most 32 KiB in canonical UTF-8 Markdown; individual fields are bounded. Never save credentials or personal task results as reusable procedure text.
- The executor owns `<data>/skills/metadata.sqlite` and `<data>/skills/<name>/SKILL.md`. Host application services own validation, provenance and confirmation. Executor-private operations are a narrow port, not a general filesystem or public model API. Only the executor opens this database. Canonical version content, revision, hash, tombstone and idempotency receipts are authoritative there. SKILL.md is its verified readable projection with JSON-quoted YAML name/description and fixed Markdown sections; no arbitrary YAML parser or external code loader.
- Save/delete requires an exact current `expectedRevision` (zero only for an unused name). Revision increases monotonically, including tombstones; recreating a deleted name requires its tombstone revision. No rename operation. Read returns current metadata and up to 20 recent versions, with exact revision retrieval available. Limits: 50 active skills, 1,024 lifetime revisions and 4,096 mutation receipts. Quotas fail closed with an actionable capacity error; no automatic receipt/version eviction. Accepted inputs retain their own bounded snapshot and do not depend on editable history retention.
- Mutations use stable request identities bound to canonical arguments. Persist intent before atomically replacing the verified prior projection; finalize revision and receipt together. Recovery accepts only the expected prior or intended new bytes, never executes unrecognized external contents. Missing/changed/symlinked projections are unavailable and are never silently imported or overwritten. No path supplied by a renderer/model selects the library root. File and directory permissions are private. A lost response reconciles the same receipt, not a second revision. An uncertain projection remains visibly unavailable until reconciliation succeeds.

### Authority

- `skill_load` and `skill_save` are Host tools routed through Tool Router with explicit local target. All Bots can read the shared library. `skill_load` requires name and exact revision/hash; it returns bounded guidance and grants nothing. Prompt metadata lists available names/descriptions/revisions/hashes through an agent-runtime port; file contents never become system policy.
- `skill_save` proposes save or delete. Only a live direct user-origin Run may propose a mutation; peer/group/unattended sources and unknown Run identities are denied. Specialists can maintain procedures without acquiring Core's Bot/group management authority. Current Run provenance and lifecycle are rechecked after approval. Every mutation requires exact approval, with no Always allow option. Denial is terminal for that call. Approval includes all fields, action and expected revision; stale review cannot overwrite a newer version.
- Private desktop `skills.list/get/save/delete` use the same validation/domain service. Explicit Save/Delete in the review UI supplies a stable request ID and revision. Pending edits remain a local draft until this action. Private executor mutation requests carry current authority revision and invocation identity; executor fences stale/revoked authority before a new mutation. Committed receipt reads can reconcile without creating fresh authority. Skill content is absent from operational logs; IDs, revisions, duration and outcome suffice.
- Stored guidance cannot relax existing file/command/web/management policy or create a grant. Do not describe Bots as isolation boundaries. Imported task/web/peer instructions cannot forge user provenance or confirmation.

### Accepted inputs and UI

- Direct messages accept up to two explicit skill references (`name`, `revision`, `sha256`). Host resolves exact reviewed content before durable acceptance and persists a bounded `SkillAttachment` snapshot with the Run message/input and Pi submission. Reused request IDs must match references as well as text/files. Missing or changed references fail before acceptance; no implicit latest-version upgrade.
- Once accepted, edit/delete of the library cannot change the message snapshot. Queue, restart, steering and explicit continuation retain it. Pi input marks the skill as user-selected, lower-priority guidance; transcript display shows the name and version without exposing injected implementation scaffolding. Legacy messages have no skills. Groups may read skills through tools; composer skill attachment in groups is deferred rather than silently discarded.
- The library offers empty/loading/error states, create/edit, readable full review, version details and explicit deletion confirmation. Composer `/` selection attaches a chip, supports keyboard/Escape/IME, removes the trigger text, and preserves selected references with the per-conversation draft. An explicit button provides the same selection. No preinstalled/demo skills or Bots. English is default; all new product labels have Chinese counterparts.
- Library changes invalidate the existing bounded observation settings bit. Reads use existing generation/stale-response guards. Never mark a chat read from library/search reads or bypass observation flow control.

## Steps

1. Save this spec before product changes. Add protocol schemas, pure validation/rendering and executor store/recovery tests.
2. Add bounded private IPC and Host domain service; integrate exact approvals, provenance and revision fencing. Add runtime prompt metadata and immutable accepted skill snapshots without exposing Pi types publicly.
3. Build bilingual library/review and composer attachments within the current UI. Add scripted model workflows and focused authorization/replay/retention regressions.
4. Run `pnpm run check`, full hidden `pnpm run e2e`, inspect English/Chinese screenshots and bundled runtime startup. Use an isolated real-model report-to-skill-to-second-Bot workflow; verify actual artifact bytes and remove temporary credential configuration.
5. Update backlog, technical plan, roadmap and this spec with evidence. Push one PR targeting main, dependent on #34. Owner merges.

## Acceptance

- A successful report yields a complete reviewable skill. Denial changes nothing; approval saves exactly one version, including lost-response/restart replay. Stale edits, request collisions, quota overflow and traversal/symlink attacks fail.
- A second Bot loads and reuses the exact procedure after restart on changed input and produces a validated artifact. A malicious instruction in the skill cannot bypass denied file/command or management authority.
- Explicit attachment survives draft reload, accepted queue/restart and continuation; subsequent edits/deletion cannot replace the accepted content. Conflicting replay fails and unavailable pre-acceptance references are actionable.
- Group/peer/unattended writes are rejected; valid Specialist private proposals work with exact review. Cancellation and authority change before dispatch prevent a new write. Receipt reconciliation never repeats a committed mutation.
- Full checks, hidden desktop flows, inspected bilingual screenshots, bundled startup and bounded real-model results are recorded. No owner-data launch, visible window, native dialog, notification, Dock badge, tray or power assertion. Native release gates remain unverified.

## Open questions

None for this increment. Stop and record a contract gap here before changing this design.

# D1: Core Bot, Specialist Bots, and Model Sources

Status: draft (product design; not an implementation contract)
Branch: task/d1-bot-product-design
Date: 2026-10-17
Depends on: B6, B7, B8
Architecture: Sections 1.1, 5.1, 5.2, 5.7, 5.9, 6.5, 7.2, and 8.3

## Goal and scope

Make OpenBot feel like a durable personal team: one permanent Core Bot manages the roster and groups, while Specialist Bots own focused work. Every Bot has its own instructions and memory. Both Pi's bundled model catalog and user-configured endpoints remain supported.

This document records research, owner requirements, recommended behavior, architecture changes, and a proposed delivery order. It changes no runtime behavior. The batches below need separate implementation specs before execution. MVP acceptance remains a separate gate; this design does not implement connectors, routines, computer control, or multi-user hosting.

### Owner requirements

- A default Core Bot exists from first use and cannot be deleted.
- The Core Bot can create, edit, and delete other Bots and create, edit, and dissolve groups.
- Specialist Bots perform agent work; they cannot manage other Bots or groups.
- Each Bot has its own Prompt and memory.
- Model setup supports Pi built-ins and custom configuration as two understandable choices.

The remaining choices below are recommendations, not claims about shipped OpenBot behavior or Grok's internal implementation.

## Research and evidence

Sources were checked on 2026-10-17. Public product documentation describes behavior; it does not establish Grok's database schema, prompt composition, scheduler, or authorization implementation.

| Evidence | Finding | Design implication |
| --- | --- | --- |
| [Grok overview](https://docs.x.ai/grok-bot/overview) | Persistent roles and context; Bots share an account's computer, files, and logins. | Keep durable identities while retaining OpenBot's shared local Mac. |
| [Create and manage Bots](https://docs.x.ai/grok-bot/bots) | Standing descriptions differ from task messages. Duplication excludes learned memory and history. Existing Bots can create focused Bots. | Make role instructions editable; default a copy to fresh memory. The owner's Core-only management rule is an explicit OpenBot choice. |
| [Message and collaborate](https://docs.x.ai/grok-bot/chat-and-collaboration) | Groups support two to six Bots, mentions, replies, and asynchronous handoffs. Approvals and secret requests stay outside group chat. | Make work ownership and handoff state visible; provide links to the responsible Bot for intervention. |
| [Approvals, security, and privacy](https://docs.x.ai/grok-bot/approvals-security-and-privacy) | Action approvals remain meaningful; Ask first overrides automatic rules. | Core management authority does not bypass action policy. |
| [Get started](https://docs.x.ai/grok-bot/get-started) | Onboarding introduces a first teammate with a job and description. | OpenBot can introduce its Core Bot immediately, with model setup attached to starting work. |
| Owner-provided screenshot | The sidebar presents individual Bots and groups; the main conversation exposes work progress and routine updates. | Preserve a messaging-first layout and visible management results. The screenshot alone cannot establish deletion or permission rules. |

The reviewed official pages do not establish that every Grok account has exactly one undeletable main Bot or that only it can manage other Bots. OpenBot should implement the owner's stated rule directly rather than claim exact Grok parity. Enterprise Team Bots are a separate multi-user feature and are outside this design.

The useful product lesson is continuity: the user talks to a recognizable teammate, sees it work, and can refine its role over time. A roster of names without persistent responsibilities, visible actions, and recoverable work would not achieve this.

## Current OpenBot implementation

Inspected on `feat/mvp` at `25b66e4` before this design branch.

| Area | Existing behavior | Gap |
| --- | --- | --- |
| Models | `BotRuntime.open()` uses Pi `builtinModels`; `model-config.ts` overlays local configuration. | The catalog does not yet express the proposed source/override UX. Catalog presence must not imply usable credentials. |
| Onboarding | Built-in provider presets and an Other endpoint form, with model testing. | No permanent Core Bot, and advanced file configuration is not a complete two-source settings experience. |
| Bot profile | `BotProfile` has name, role, instructions, model, thinking level, pin, and lifecycle status. | No protected identity or Core/Specialist distinction. |
| Prompt | Shared prompt sections plus each Bot's configured `instructions`. | No management-role section or role-specific management tool exposure. |
| Memory | `openbot.memory`, keyed by `botId`, up to 8 KiB of Markdown. `memory_update` uses the trusted calling Bot ID. | No revision/history model for concurrent edits or targeted management corrections. |
| Duplicate | `HostService` copies profile settings and learned memory. | Recommended fresh-memory default is a behavior change, requiring an explicit spec and e2e update. |
| Bot lifecycle | UI can create, edit, duplicate, hide, and delete Bots. Delete stops work and retains stored history. | No Core protection across Host methods; no model-facing roster management tools. |
| Groups | Architecture and backlog describe groups/handoffs. | No implemented group model or collaboration flow. |

Relevant code: [protocol](../../packages/protocol/src/index.ts), [runtime](../../packages/agent-runtime/src/index.ts), [prompt sections](../../packages/agent-runtime/src/prompt.ts), [memory](../../packages/agent-runtime/src/memory.ts), [Host service](../../packages/server-core/src/index.ts), [memory tool](../../packages/server-core/src/memory-tool.ts), [model configuration](../../packages/agent-runtime/src/model-config.ts), and [provider editing](../../packages/server-core/src/model-providers.ts).

## Recommended product model

### One permanent Core Bot

Use **Core Bot** and **Specialist Bot** in product copy. A Specialist is a persistent peer for doing work, not an ephemeral subagent spawned for one model turn. It may use the same model as the Core Bot or a different one.

- Create the Core Bot locally before the first inference request. Missing model credentials must not prevent the roster from opening.
- Give it a stable ID independent of its display name, model, conversation, and prompt. Exactly one Core exists per local user data store.
- Default its name to OpenBot; allow the user to rename it and change its avatar, instructions, model, and memory.
- Keep it at the top of the sidebar with a Core badge. It cannot be hidden, unpinned from that position, deleted, or demoted. Stop, New topic, and clear-memory actions remain available.
- A duplicate of the Core is always a Specialist, with no management authority or learned memory.
- On migration, create a new Core and preserve existing Bots as Specialists. Do not silently promote an existing specialist, rewrite its instructions, or move its history. Migration must be restart-safe.
- Starting a new topic or changing models preserves the Core identity. A model outage does not prevent the user from managing Bots directly through the UI.

The Core is the default entry point for unclear or cross-Bot work, but users can always talk directly to a Specialist. Routing every request through the Core would increase latency and create a single conversational bottleneck.

### Authority is separate from execution capability

| Action | Human through UI | Core Bot | Specialist Bot |
| --- | --- | --- | --- |
| Perform file, command, and research tasks | Configure/approve | Yes, under policy | Yes, under policy |
| Create or duplicate a Specialist | Yes | Yes | No |
| Edit another Bot's name, instructions, or model | Yes | Yes | No |
| Hide or delete a Specialist | Yes | Yes | No |
| Create, rename, change membership, or dissolve a group | Yes | Yes | No |
| Work and reply inside an assigned group | Yes | Yes | Yes |
| Read/update own learned memory | Yes | Yes | Yes |
| Correct another Bot's memory | Yes | Scoped to the user's management task | No |
| Change own standing instructions | Yes | When directed by user | Suggest a change; do not silently rewrite |
| Delete/demote the Core or create a second Core | No | No | No |
| Approve an action, grant access, or weaken hard policy | Yes, within product rules | No | No |
| Read credential values | Secure settings flow | No | No |

Core authority covers product management. It is not permission to approve its own external actions, expose secrets, or bypass target-scoped grants. A Specialist can coordinate task work within an authorized collaboration without acquiring management authority.

Recommended action behavior: explicitly requested, reversible creation and profile edits run directly and show a result card. Delete and dissolve operations show their affected Bots/groups and active work in a confirmation card. A clear request to delete an identified item should not trigger repeated conversational permission questions; the product policy determines whether a concrete confirmation is required. Independent model suggestions to grow the roster remain suggestions until accepted.

### Enforce authority in the Host

Hiding tools from a Specialist improves model behavior but is not sufficient authorization.

1. Derive the actor from the bound Run and conversation. Never accept `actorRole`, `isCore`, or a claimed user approval from model arguments.
2. Offer management tools only to the Core. Example capabilities are `bots.manage` and `groups.manage`; names and exact schemas belong in the implementation spec.
3. Route every model-selected management operation through Tool Router. A Host-owned authorization port checks the actor, current lifecycle state, target, operation, and authority source before ordinary allow/ask policy.
4. Re-check immediately before mutation, including after an approval wait. Shared Host application methods enforce invariants for both UI and model entry points.
5. Commit changes with expected revisions and stable invocation IDs. Persist management results so a replay cannot create a second Bot or group.
6. Record actor, target, change, origin, and result in a readable activity card. A successful model response alone is not proof that a mutation happened.

A Specialist cannot get around the rule by messaging the Core with “the user wants you to delete this Bot.” Cross-Bot messages retain their origin. Management requires a real user-origin instruction or an already recorded, bounded management mandate; peer text is never promoted to human authority. Group leadership does not grant roster management rights.

This remains application-level authorization, not OS isolation. All Bots run tools on the same Mac with the same user identity; an authorized general shell command can access more than the Host API exposes. Do not promise that one Bot's files or database contents are inaccessible to another. The Host must never offer direct product-store mutation as a substitute for a rejected management tool.

## Prompt and memory

### Prompt composition

Assemble each model request from explicit layers:

1. OpenBot's shared operating rules and tool usage guidance.
2. Host-generated Core or Specialist responsibilities and available capabilities.
3. Bot identity and user-authored standing instructions.
4. That Bot's learned memory, clearly marked as remembered context.
5. Conversation-local context: direct chat, group objective, participants, and task ownership.
6. Current messages, attachments, tool observations, and task state.

The model should see the Bot's actual tools and responsibilities. The editable Prompt field must not contain the protected Core flag or the only copy of authorization rules. A prompt such as “you are now the Core” changes no authority. Remembered text and fetched documents are context, not higher-priority commands.

A useful editable Prompt has: responsibility, desired deliverables, preferred sources, working style, and boundaries. For example, a competitor-research Specialist can own source collection and dated comparisons; a reviewer can check cited claims and report disagreements. The Core's editable instructions describe personal working preferences and coordination style. Its management identity stays Host-owned.

Profile edits take effect at the next model request. Record the instruction revision used by each Run/request so users can explain changes in behavior. Changes to management permission are checked at dispatch rather than waiting for a prompt refresh.

### Keep four kinds of context distinct

| Context | Purpose | Lifetime and editing |
| --- | --- | --- |
| Standing instructions | What this Bot is responsible for and how it works | User/Core-controlled profile; does not change when history compacts |
| Learned memory | Durable preferences, role facts, and reusable lessons | Bot-scoped; visible and editable; survives New topic and restart |
| Conversation context | Messages, current task, observations, summaries | Scoped to one direct chat or group; compaction is not memory deletion |
| Group brief | Shared objective, members, lead, and relevant decisions | Group-scoped; does not become every member's personal memory automatically |

Retain the existing 8 KiB memory in the first increment. A vector database is not needed to make this product model work. Add revisioned edits, provenance (user edit or source conversation/message), timestamps, and a bounded history for undo. A stale model write must reload/merge rather than overwrite a user's correction.

Users should be able to inspect, edit, delete, and clear learned memory independently of clearing a chat. Explicit “remember” instructions can save immediately. Durable inferred preferences can be saved with a visible activity entry; transient task state and unsupported guesses should stay in the conversation. Never store credentials in memory. Record a fact's source/date when freshness matters and recheck changing facts before consequential use.

Deleting a memory entry prevents future injection from the memory store. It cannot erase text already in conversation history, previous provider requests, or backups. Offer a separate history-reset action and avoid claiming that “forget” means complete data erasure.

Specialists start with an empty memory. Copying a profile does not copy memory or history; explicit transfer can be a later operation with a selected preview. The Core should not receive all Specialists' memories and transcripts in every request. It can inspect a specific Bot's relevant context when the user's task calls for it, with a visible record.

Do not add an implicitly shared user-memory layer in the first increment. If users repeatedly need preferences shared across Bots, add an explicit user-editable “Shared preferences” scope later. Keep Bot memory semantically separate while acknowledging that shared local execution is not a privacy boundary.

## Groups and collaboration

### Group lifecycle and routing

- A group has a stable ID, name, objective, member IDs, lead Bot, revision, and active/dissolved state. Initially support two to six Bots; the human user is implicit.
- The user or Core creates the group and selects a lead. The Core need not be a member. A Specialist lead can coordinate work but cannot change the group's membership or lifecycle.
- `@Bot` routes to that member; replying to a Bot routes to it; without an explicit recipient, route to the designated lead. Multiple mentions and `@everyone` create bounded, separately identified deliveries.
- A Bot's normal group post does not wake every other Bot. A follow-up requires an explicit task message/handoff. Otherwise a friendly acknowledgement loop can consume unlimited turns.
- Within a user-authorized group task, Specialists can send bounded work requests to members and return results. Out-of-group work needs a user/Core assignment. Include a task ID, origin, expected output, reply destination, deduplication key, and hop/turn budget.
- Start with proposed limits of two delegation hops and twelve automatic Bot deliveries per root task; expose exhaustion as a paused collaboration requiring user continuation. Exact defaults need scripted workload validation in the group spec.
- Work may run in parallel under the existing global cap. Transfer ownership explicitly; the sender must not continue the same task after a handoff unless assigned a different part.
- Approvals belong to the executing Bot/Run. The group shows a status and deep link; another Bot cannot approve them. Stop group work cancels only that group's queued and active tasks.

Dissolving a group stops new delivery, cancels its queued/running work, and retains a read-only transcript. It does not delete its Bots or their files. Membership removal increments a version: re-check membership before queued work starts and before a result is delivered. A removed Bot's unfinished work is cancelled; an already committed result remains attributed.

Deleting a Specialist cancels its Runs and pending delivery, removes membership, and disables its future routines when those exist. If it was a lead, ask the user/Core to choose a replacement; mark the group inactive if fewer than two active Bots remain. Shared files and credentials remain untouched. Cancellation must retain uncertain execution outcomes rather than report unconfirmed work as stopped.

### Separate direct-chat and group contexts

Architecture Section 5.7 currently feeds group messages into each Bot's main conversation. Recommend changing that before group implementation:

```text
Bot identity + standing instructions + learned memory
    |-- direct conversation
    |-- conversation for group A
    `-- conversation for group B

Group transcript = attributed, explicitly published messages
```

Use one model conversation per `(botId, channelId)`, plus a group transcript that is not itself an agent. A group turn includes relevant group history and that Bot's instructions/memory, without automatically including its direct-chat transcript. Cross-channel transfers carry selected context explicitly. This reduces accidental conversation mixing; it does not provide isolation from shared memory or files.

For the first group implementation, serialize Runs per Bot across its channels, while allowing different Bots to run in parallel. This avoids competing writes to one Bot's memory and preserves a comprehensible “what is this Bot doing?” state. Direct user input can take queue priority, but only steers an active Run in the same channel; it must never become a reply in the wrong group. Later per-Bot parallelism requires deliberate memory and task ownership rules.

This is a proposed change to conversation mapping and scheduling, not a description of current Pi integration. It requires replacing the current single-main-conversation lookup for prompt identity and updating cancellation, observers, New topic, approvals, and recovery accordingly. Pi remains behind `agent-runtime`.

## Model sources

Present two entry points under **Models**:

| Entry | User experience | Data ownership |
| --- | --- | --- |
| Built-in models | Browse the bundled Pi provider/model catalog, configure supported authentication, test, and select | Bundled metadata; credentials in Keychain |
| Custom providers | Add endpoint, protocol, model IDs, optional capabilities and limits; support existing advanced configuration | User-level `~/.openbot/models.json`; UI-entered secrets in Keychain |

Both feed one resolved model registry. A Bot stores only a model reference, or inherits the application default. The Core has no privileged model and Specialists can choose independently. Switching providers must not change a Bot's identity, prompt, or memory.

- Model identity is `(providerId, modelId)`, never the display name. A custom provider hosting a known model remains distinct from the built-in provider.
- Track origin and overrides separately: a built-in model with a local endpoint override appears once, with an override badge and effective endpoint. Removing the override restores its bundled definition.
- Show catalog availability, credential readiness, and last test result separately. Do not label a model “connected” just because it appears in Pi's catalog. Built-in metadata is bundled at the vendored revision, not automatically current.
- Custom configuration currently supports `openai-completions`, `openai-responses`, and `anthropic-messages`. Audit built-in authentication flows before promising every Pi provider or OAuth flow; unsupported flows should be explicit.
- Keep advanced JSONC support. Current UI writing uses plain JSON and refuses commented files; a new editor must preserve comments and unrelated provider fields or clearly leave the file untouched. Never silently flatten an advanced configuration.
- File removal of an in-use custom model should yield an actionable “model unavailable” state, not an invisible fallback to a different provider. UI removal should identify affected Bots and offer explicit reassignment.
- Test connection results should distinguish authentication, endpoint, protocol, and model errors. Ordinary chat success does not prove tool calling or vision; capability checks need separate scripted acceptance and optional provider spot checks.
- Respect existing credential precedence: Keychain, configured credential source, then built-in sources. Do not import the entire login-shell environment; the current desktop `$NAME` credential limitation remains a separate known gap.

## Product surfaces and example flow

Sidebar: Core at the top; pinned Specialists, other Specialists, and groups below. Creation offers New Bot and New group. Core profile controls omit Delete/Hide; Host methods also reject them. A Specialist's profile shows Profile, Instructions, Memory, and Model. Group details show objective, lead, and members.

Example: the user asks the Core to create two research Specialists and a reviewer, then put them in a research group. The Core creates focused profiles and shows compact cards linking to each Bot and the group. The user can edit the generated instructions immediately. A group request assigns source collection to the researchers and synthesis to its lead. The reviewer checks claims and posts findings. Progress is visible in one group, and each Bot retains its own role memory.

This example does not automatically create a scheduled routine. If the user also asks for a daily report, routine setup is a separate B11 capability with its own schedule, time zone, missed-run, and approval behavior. OpenBot work depends on the Mac and Host being available; Grok's cloud continuation cannot be copied as a local-product promise.

## Proposed delivery order

These are approach-level batches, not ready execution specs. Keep one implementation spec and PR per batch. B9–B12 can continue independently where their prerequisites allow; do not require connectors or browser control to establish the Core model.

| Order | Proposed batch | Result and acceptance focus |
| --- | --- | --- |
| 1 | B16: Model sources | Built-in/custom UI, effective-source metadata, safe config editing, selection and removal behavior; scripted connection and override tests |
| 2 | B17: Permanent Core identity | First launch and idempotent migration, protected lifecycle across all Host entry points, editable profile; restart and forged-request tests |
| 3 | B18: Core management tools | Core creates/edits/deletes Specialists through routed, revisioned, idempotent Host actions; Specialist denial and peer-origin escalation tests |
| 4 | B19: Instructions and memory controls | Clear profile UX, fresh-memory duplication, revision conflict handling, visible edits/undo; New topic/restart/copy/isolation-of-injection tests |
| 5 | B13, split into specs | First channel-scoped contexts; then group lifecycle; then bounded collaboration/handoff. Keep templates and usage separate from this critical path. |

B18 covers Bot management first. Group management tools arrive with group lifecycle, rather than exposing tools for nonexistent objects. B19 improves existing memory instead of blocking Core identity on a new retrieval subsystem.

Before execution, update architecture contracts for protected identity, trusted actor authorization, channel mapping, scheduling, and lifecycle. Then write exact protocol/document schemas and migration steps in each batch spec. Do not modify vendored Pi unless a proven adapter gap requires a separately traceable patch.

## Required future verification

1. Fresh store, missing model, repeated startup, and interrupted migration all leave exactly one usable Core identity.
2. Direct Host calls cannot hide/delete/demote the Core; copying it produces a Specialist.
3. A Specialist's fabricated management call, claimed Core identity, and indirect request through the Core all fail without a human management mandate.
4. Core management still honors hard policy and pending approval changes. Replaying a successful create operation returns the original object.
5. Different Bots retain distinct instructions and memory after restart, model changes, and New topic. Copy starts with empty memory.
6. Stale memory writes cannot overwrite a user edit; undo records a new revision; clearing memory does not falsely claim to erase history.
7. Direct-chat history is not injected into a group turn. Group A results cannot publish into group B because a model supplied a destination string.
8. Mentions, default lead routing, queue priority, membership changes, delete/dissolve, and cancellation preserve origin and scope.
9. Restart during delivery/handoff produces no duplicate task or group message. Automatic collaboration stops at its budget.
10. Built-in, new custom, and overridden built-in models resolve distinctly; JSONC survives UI edits; missing credentials and removed models are actionable and secret-free.

Each implementation batch runs `pnpm run check`, background `pnpm run e2e`, and screenshot inspection. Use ScriptedModel for authorization, routing, recovery, and UI behavior. Real-model spot checks validate instruction-following quality separately and never substitute for Host enforcement. This design-only change requires document/link validation; it does not launch the app or run e2e.

## Open questions for implementation specs

- 2026-10-17: Confirm whether migration should optionally offer promotion of an existing Bot. The recommendation is a new Core with all old Bots preserved unchanged.
- 2026-10-17: Set the management confirmation policy, including undo retention for Bot deletion and group dissolution, before B18/group lifecycle are ready.
- 2026-10-17: Specify how user-origin management mandates are recorded and bounded across queued work; natural-language claims alone are insufficient.
- 2026-10-17: Specify memory history retention, selected context transfer, and how a user correction interacts with older conversation context before B19 is ready.
- 2026-10-17: Fix group delivery budgets and the exact per-Bot queue/priority rules using scripted workloads before collaboration is ready.
- 2026-10-17: Audit which bundled Pi authentication flows OpenBot can actually expose; do not promise complete Pi UI feature parity from model-catalog support alone.

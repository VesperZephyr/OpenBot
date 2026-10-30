# Task Specs

A task spec is the execution contract and the sole maintained record of its task status. This index is navigation, not a second status board. Read the spec header before starting work; use the [backlog](../backlog.md) for priority and [AGENTS.md](../../AGENTS.md) for contribution and verification rules.

## Lifecycle

| Status        | Meaning                                                   | Who changes it                      |
| ------------- | --------------------------------------------------------- | ----------------------------------- |
| `draft`       | Being designed; do not start                              | Design                              |
| `ready`       | Contracts and acceptance are fixed; anyone may pick it up | Design                              |
| `in progress` | Claimed: the spec names the branch                        | Executor                            |
| `in review`   | Pull request open, acceptance checked                     | Executor                            |
| `done`        | Merged to `main`; merge reference recorded in spec          | Owner merges, executor updates docs |

To claim a ready task, set its **Status** to `in progress`, fill in **Branch**, push the branch, and open a draft PR linked to it. Use `in review` when acceptance is checked and owner review remains; only a merge makes it `done`. On merge, record the merge reference in the spec and remove its active backlog entry. Add new specs to this index without copying status, implementation summaries, or test counts.

Acceptance evidence lives in the spec or one linked dated record under `docs/acceptance/`. Completed specs retain the contract and evidence for that delivery; do not keep updating their implementation descriptions as product APIs evolve. Update maintained architecture or known-gap records only when the relevant facts change.

## When the spec does not fit reality

Do not redesign silently. Add a dated entry under **Open questions** describing what you found and stop that part of the work; continue with the parts that do not depend on it. Small, local decisions the spec leaves open (names, file layout inside a module, helper functions) are yours; record them in the pull request description. Anything that changes a contract, a protocol message, persistence format, or a user-visible behavior goes back to design.

## Spec template

Copy this into `docs/tasks/<id>-<slug>.md`.

```markdown
# <ID>: <Title>

Status: draft | ready | in progress | in review | done
Branch: task/<id>-<slug>
Depends on: <task IDs or "none">
Architecture: <sections this task implements>

## Goal
One paragraph: the user-visible or safety outcome, and why it matters now.

## Scope
In: bullet list. Out: bullet list, each with where it lives instead.

## Design
The choice, rationale, constraints, and conditions for revisiting it. Include alternatives only when they explain the trade-off.

## Contracts
Define new or changed interfaces, compatibility promises, migrations, and invariants precisely enough to execute. Link existing source contracts instead of copying unchanged types.

## Steps
Ordered implementation cuts and how to verify each; omit line-by-line coding instructions.

## Acceptance
Numbered, observable checks. Each says which test proves it (unit test name, e2e test name, or a scripted smoke).

## Risks
What may break, how to detect/recover, and which external or native evidence remains necessary.

## Open questions
Dated blockers found during execution. Empty when ready.

## Evidence
Candidate revision, acceptance checks and outcomes, and remaining limits; or link one dated acceptance record. Record non-obvious pitfalls with trigger, cause, workaround, regression evidence, and removal condition.
```

## Design and research

- [D1: Core Bot, Specialist Bots, and Model Sources](d1-bot-product-design.md)
- [D2: Grok Bot Interaction Research](d2-grok-ui-research.md)
- [D3: Application Capabilities and Local Code Mode](d3-app-capabilities.md)
- [D4: Post-B26 Delivery Plan](d4-delivery-plan.md)
- [D5: Local Memory Research](d5-memory-research.md)
- [D6: Persistent Roles, Memory and Skills Research](d6-bot-role-design.md)
- [D6: A Personal Assistant with Character](d6-desktop-design.md)

## MVP and execution foundation

- [B1: Durable Approvals and Executor Receipts](b1-durable-approvals.md)
- [B2: Runs, Queue, Cancellation, and Steering](b2-runs.md)
- [B3: Coding-Agent Tools](b3-coding-tools.md)
- [B4: Web Research](b4-web-research.md)
- [B4a: Reliable web pagination and research coverage](b4a-web-pagination.md)
- [B5: Always Allow and Folder Grants](b5-always-allow.md)
- [B6: Bot Quality and Memory](b6-bot-quality.md)
- [B6a: Evidence-Based Bot Delivery](b6a-prompt-reliability.md)
- [B7: Desktop MVP](b7-desktop-mvp.md)
- [B7a: Background Desktop Tests](b7a-background-e2e.md)
- [B8: Installable Build](b8-installable-build.md)
- [B8a: Login Shell Command Path](b8a-login-path.md)

## Bot and conversation experience

- [B16: Built-in and Custom Model Setup](b16-model-sources.md)
- [B17: Permanent Default Core Bot](b17-core-bot.md)
- [B18: Core Bot Management Tools](b18-core-management.md)
- [B19: Bot Instructions and Memory Controls](b19-memory-controls.md)
- [B20: Desktop Experience and English / Chinese](b20-desktop-experience.md)
- [B21: Conversation Experience](b21-conversation-experience.md)
- [B22: Conversation List Previews and Unread State](b22-conversation-list.md)
- [B23: Local Conversation Search and Unread Filtering](b23-conversation-search.md)
- [D7: White chat canvas and focused interactions](d7-chat-interaction.md)
- [D8: Unified chat and continuous activity feedback](d8-chat-experience.md)
- [D9: Files and read-only document previews](d9-file-reading.md)
- [D10: Reader polish and real report acceptance](d10-reader-polish.md)

## Collaboration and application capabilities

- [B13a: Conversation Contexts per Channel](b13a-channel-contexts.md)
- [B13b: Group Lifecycle](b13b-group-lifecycle.md)
- [B13c: Core Entry and Bounded Bot Collaboration](b13c-collaboration.md)
- [B13d: Local Usage and Execution Evidence](b13d-usage-evidence.md)
- [B13e: Bot template import and export](b13e-bot-templates.md)
- [B24: Authorized Application Capability API](b24-app-capability-api.md)
- [B25: Local Read-Only Application Code Mode](b25-local-app-code-mode.md)
- [B26: Core Management Through Application Code Mode](b26-code-mode-management.md)

## Skills, memory, routines, and connectors

- [B9a: Supervised Local Stdio Connectors](b9a-stdio-connectors.md)
- [B9b: HTTPS MCP Sessions](b9b-https-connectors.md)
- [B10: Reviewed Reusable Skills](b10-reviewed-skills.md)
- [B11a: Local Scheduled Routines](b11a-local-routines.md)
- [B11b: Scheduled reports in group conversations](b11b-group-routine-reports.md)
- [B11c: Scheduled summaries of routine reports](b11c-scheduled-report-summaries.md)
- [B11d: Unattended workflow reliability](b11d-unattended-reliability.md)
- [B11e: Bot routines and generated-file Library](b11e-bot-routines-library.md)
- [B12a: Deterministic Policy, Revocation, and Unattended Approval Expiry](b12a-deterministic-policy.md)
- [B27a: Attributable Memory and Explicit Sharing](b27a-memory-provenance.md)
- [B27b: Per-Role Skill Defaults](b27b-role-skills.md)

## Reliability and local data

- [B14a: Reliable, Bounded Desktop Observation](b14a-reliable-observation.md)
- [B14b: Lifecycle Gates and Explicit Continuation](b14b-lifecycle-gates.md)
- [B14c: Bounded history reading and persistent search](b14c-history-scaling.md)
- [B14d: Consistent local backup and restore](b14d-backup-restore.md)
- [B14e: Desktop-Owned Keychain Credentials](b14e-main-credentials.md)
- [B15a: Bounded File Inputs and Result Artifacts](b15a-bounded-artifacts.md)
- [B15b: Durable Background Command Completion](b15b-background-completion.md)

## Integration and acceptance

- [I1: Integrated Product Foundation](i1-product-foundation.md)
- [I2: MVP Acceptance Candidate and Bilingual Introduction](i2-mvp-acceptance.md)
- [I3: Repeatable Workflow Acceptance](i3-workflow-acceptance.md)
- [I4: Real-Model Role and Memory Acceptance](i4-role-memory-acceptance.md)
- [Desktop regression coverage audit](i5-e2e-audit.md)
- [I5: E2E coverage and execution efficiency](i5-e2e-efficiency.md)
- [I6: Integrated daily radar acceptance](i6-radar-integration.md)
- [I7: Official changelog pagination](i7-official-changelog-pagination.md)

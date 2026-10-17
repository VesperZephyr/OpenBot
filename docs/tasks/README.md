# Task Specs

A task spec turns one backlog batch into work that an agent or contributor can finish without the design conversation. Design writes the spec; execution follows it. The spec is the contract for the pull request.

## Lifecycle

| Status        | Meaning                                                   | Who changes it                      |
| ------------- | --------------------------------------------------------- | ----------------------------------- |
| `draft`       | Being designed; do not start                              | Design                              |
| `ready`       | Contracts and acceptance are fixed; anyone may pick it up | Design                              |
| `in progress` | Claimed: the spec names the branch                        | Executor                            |
| `in review`   | Pull request open, acceptance checked                     | Executor                            |
| `done`        | Merged to `main`; backlog and technical plan updated      | Owner merges, executor updates docs |

To claim a task, set **Status** to `in progress`, fill in **Branch**, push the branch, and open a draft pull request that links the spec. One task per branch.

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
The decided approach, with the alternatives considered and why they lost. Diagrams where they help.

## Contracts
Exact types, protocol messages, document shapes, file formats, and their invariants. Code blocks with TypeScript.

## Steps
Ordered, each small enough for one commit, each naming the files it touches and how to check it.

## Acceptance
Numbered, observable checks. Each says which test proves it (unit test name, e2e test name, or a scripted smoke).

## Risks
What may break, how to notice, what to do.

## Open questions
Dated entries added during execution. Empty when ready.
```

## Index

Product design (not an implementation task): [D1: Core Bot, Specialist Bots, and Model Sources](d1-bot-product-design.md), **draft**. Research, recommended contracts, and proposed B16–B19/B13 sequencing; no product code changes.

Phase 1 (MVP). Every batch is implemented on `feat/mvp` and in review until the owner's acceptance run.

| ID                            | Title                                   | Status        |
| ----------------------------- | --------------------------------------- | ------------- |
| [B1](b1-durable-approvals.md) | Durable approvals and executor receipts | in review     |
| [B2](b2-runs.md)              | Runs, queue, cancellation, and steering | in review     |
| [B3](b3-coding-tools.md)      | Coding-agent tools                      | in review     |
| [B4](b4-web-research.md)      | Web research                            | in review     |
| [B5](b5-always-allow.md)      | Always allow and folder grants          | in review     |
| [B6](b6-bot-quality.md)       | Bot quality and memory                  | in review     |
| [B7](b7-desktop-mvp.md)       | Desktop MVP                             | in review     |
| [B8](b8-installable-build.md) | Installable build                       | in review     |
| [B7a](b7a-background-e2e.md) | Background desktop tests                | in review     |
| [B8a](b8a-login-path.md) | Login shell command path | in review |

## Product foundation

Execute in order: B16, B17, B18, B19, B13a, B13b, B13c. Only ready specs may start.

| Task | Status |
| --- | --- |
| [B16](b16-model-sources.md) | in review |
| [B17](b17-core-bot.md) | ready |
| [B18](b18-core-management.md) | draft |
| [B19](b19-memory-controls.md) | draft |
| [B13A](b13a-channel-contexts.md) | draft |
| [B13B](b13b-group-lifecycle.md) | draft |
| [B13C](b13c-collaboration.md) | draft |

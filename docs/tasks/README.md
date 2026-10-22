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

Desktop design: [D6: Personal Assistant Design](d6-desktop-design.md), **done; merged in PR #49**. Owner-approved chat redesign, ordinary Bot list with protected personal-assistant star, focused editable profiles and durable local generated/uploaded avatars. Includes the original standalone design study.

Product design (not an implementation task): [D1: Core Bot, Specialist Bots, and Model Sources](d1-bot-product-design.md), **accepted direction**. Research and task contracts for the product foundation. Agent mechanisms continue to reuse Pi.

Interaction research: [D2: Grok Bot UI](d2-grok-ui-research.md), **research complete**. Official documentation, the supplied screenshot and installed-client inspection inform [B21](b21-conversation-experience.md), the conversation-experience spec merged in PR #17, and [B22](b22-conversation-list.md), the conversation-list increment. D2 remains the research record.

Delivery planning: [D4: Post-B26 Delivery Plan](d4-delivery-plan.md), **done, documentation only**. The [development roadmap](../development-roadmap.md) orders remaining work against merged `main` through B26, with execution packets, dependencies and acceptance gates. Unimplemented packets are planning briefs, not ready specs.

Memory research: [D5: Local Memory](d5-memory-research.md), **research complete, in review (#44)**. [Source-backed report](../research/memory-design.md), bilingual SQLite matching probe, and proposed implementation decisions; no product contract or schema changes.

Architecture design: [D3: Application Capabilities and Local Code Mode](d3-app-capabilities.md), **accepted direction**. Defines a shared authorized Host capability surface and reuse of vendored Pi Code Mode. B24 and B25 are merged into `main`; B26 is merged in PR #27 with exact-approved management composition and its recovery acceptance matrix.

Phase 1 (MVP) implementation is merged into `main`. Historical verification is recorded in the specs; native packaged release evidence remains separate in G0 of the roadmap.

| ID                            | Title                                   | Status        |
| ----------------------------- | --------------------------------------- | ------------- |
| [B1](b1-durable-approvals.md) | Durable approvals and executor receipts | done     |
| [B2](b2-runs.md)              | Runs, queue, cancellation, and steering | done     |
| [B3](b3-coding-tools.md)      | Coding-agent tools                      | done     |
| [B4](b4-web-research.md)      | Web research                            | done     |
| [B5](b5-always-allow.md)      | Always allow and folder grants          | done     |
| [B6](b6-bot-quality.md)       | Bot quality and memory                  | done     |
| [B7](b7-desktop-mvp.md)       | Desktop MVP                             | done     |
| [B8](b8-installable-build.md) | Installable build                       | done     |
| [B7a](b7a-background-e2e.md) | Background desktop tests                | done     |
| [B8a](b8a-login-path.md) | Login shell command path | done |

## Product foundation

The listed foundation increments are merged into `main` through B26. Remaining work follows D4; agent mechanisms continue to reuse Pi. Only ready implementation specs may start.

| Task | Status |
| --- | --- |
| [B16](b16-model-sources.md) | done |
| [B17](b17-core-bot.md) | done |
| [B20](b20-desktop-experience.md) | done |
| [B18](b18-core-management.md) | done (PR #11) |
| [B19](b19-memory-controls.md) | done |
| [B13A](b13a-channel-contexts.md) | done (PR #13) |
| [B13B](b13b-group-lifecycle.md) | done |
| [B13C](b13c-collaboration.md) | done |
| [B21](b21-conversation-experience.md) | done (PR #17) |
| [B22](b22-conversation-list.md) | done |
| [B23](b23-conversation-search.md) | done |

## Application capabilities

| Task | Status |
| --- | --- |
| [B24: Authorized application API](b24-app-capability-api.md) | done (PR #23, merged into main) |
| [B25: Local app Code Mode](b25-local-app-code-mode.md) | done (PR #24, merged into main) |
| [B26: Code Mode management](b26-code-mode-management.md) | done ([PR #27](https://github.com/VesperZephyr/OpenBot/pull/27), merged into main) |

## Usage and execution evidence

| Task | Status |
| --- | --- |
| [B13d: Local usage and execution evidence](b13d-usage-evidence.md) | done through I1 (#34); original evidence in the spec |

## Desktop reliability

| Task | Status |
| --- | --- |
| [B14a: Reliable, bounded observation](b14a-reliable-observation.md) | done through I1 (#34) |

## Post-B26 delivery

| Task | Status |
| --- | --- |
| [B15a: Bounded file inputs and result artifacts](b15a-bounded-artifacts.md) | done through I1 (#34); original evidence in the spec |

## Lifecycle foundation

| Task | Status |
| --- | --- |
| [B14b: Lifecycle gates and explicit continuation](b14b-lifecycle-gates.md) | done through I1 (#34) |

## Deterministic permissions

| Task | Status |
| --- | --- |
| [B12a: Deterministic policy, revocation and approval expiry](b12a-deterministic-policy.md) | done through I1 (#34) |

## Integration gates

| Task | Status |
| --- | --- |
| [I1: Integrated product foundation](i1-product-foundation.md) | done (#34); integrates the reviewed PR #29–#33 implementations |
| [I2: MVP acceptance and bilingual introduction](i2-mvp-acceptance.md) | done (#40); 461 unit/Host and 122 hidden e2e tests; real-model and packaging evidence recorded |

| [I3: Repeatable workflow acceptance](i3-workflow-acceptance.md) | done (#42); 477 unit/Host and 131 hidden e2e tests; real-model workflow evidence |

## Reusable procedures

| Task | Status |
| --- | --- |
| [B10: Reviewed reusable skills](b10-reviewed-skills.md) | done (#35) |

## Background completion

| Spec | Status |
| --- | --- |
| [B15b: Durable background command completion](b15b-background-completion.md) | done (#36) |

## Connectors

| Spec | Status |
| --- | --- |
| [B9a: Supervised local stdio connectors](b9a-stdio-connectors.md) | done (#37) |
| [B9b: HTTPS MCP sessions](b9b-https-connectors.md) | done (#39); 461 unit/Host and 120 hidden e2e tests |

## Credential ownership

| Spec | Status |
| --- | --- |
| [B14e: Desktop-owned Keychain credentials](b14e-main-credentials.md) | done (#38); 433 unit/Host and 115 hidden e2e tests; native/real-model evidence in the spec; Developer ID gate open |

## Local scheduling

| Spec | Status |
| --- | --- |
| [B11a: Local scheduled routines](b11a-local-routines.md) | done (#41); 477 unit/Host and 127 hidden desktop tests |

## Per-role methods

| Spec | Status |
| --- | --- |
| [B27b: Per-role skill defaults](b27b-role-skills.md) | done (#47); 484 unit/Host tests; desktop/CI evidence in PR |

## Prompt reliability

| Spec | Status |
| --- | --- |
| [B6a: Evidence-based Bot delivery](b6a-prompt-reliability.md) | done (#43); 479 unit/Host and 132 hidden e2e tests; real-model report and unknown-write trial |

## Local role foundations

| Spec | Status |
| --- | --- |
| [B27a: Attributable memory and explicit sharing](b27a-memory-provenance.md) | done (#46); 490 unit/Host and 135 hidden desktop tests |

## Role acceptance

| Spec | Status |
| --- | --- |
| [I4: Real-model role and memory acceptance](i4-role-memory-acceptance.md) | in verification; bounded real-model smoke and deterministic role/group integration; explicit spending limits |

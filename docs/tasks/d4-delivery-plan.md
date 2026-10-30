# D4: Post-B26 Delivery Plan

Status: done (#28); documentation only
Branch: task/d4-delivery-roadmap; pull request target: main
Depends on: merged B26, D1/D2/D3 and the supplied Grok research
Architecture: Sections 2, 4, 5, 7, 8, 10 and 11

## Goal

Turn the supplied research into a current, ordered delivery plan with concrete user outcomes, dependency gates, ownership, acceptance evidence and explicit unresolved contracts. Do not implement any planned feature in this task.

## Scope

In: import the research snapshot unchanged from `4568df0`, update its roadmap against `main` at `54c2a1c`, define the next execution packets and integration workflow, and link the plan from the repository indexes. Correct stale documentation about merged work and the existing B26 callable surface.

Out: product code, Pi/vendor updates, new dependencies, actual execution specs marked ready, application launches, model calls, native permission changes, releases and a fresh competitor benchmark. The source research checkout remains intact.

## Design

Documentation ownership: the [roadmap](../development-roadmap.md) retains planning rationale and future prerequisites; the [backlog](../backlog.md) owns the active queue. The [architecture](../architecture.md) owns lasting runtime contracts, the [technical plan](../technical-plan.md) owns gaps and pitfalls, and individual specs own task status, execution contracts and delivery evidence. The research remains a dated evidence record and does not turn inferred competitor internals into OpenBot requirements.

Keep existing batch IDs. B14a is the next implementation spec to prepare; B15a delivers the next visible improvement. Lifecycle and deterministic policy precede unattended work. Skills, completion delivery, connector tools and routines compose a measurable workflow. Browser/native desktop capabilities retain separate feasibility and permission gates. Public release evidence stays distinct from automated development readiness.

## Steps

1. Read the supplied research and roadmap, current architecture, technical plan, backlog and merged implementation specs.
2. Verify the `main` baseline and distinguish merged capability from outstanding release evidence.
3. Update the roadmap's priorities, dependencies, first four execution packets, API/Pi reuse rules, evidence matrix and delivery queue.
4. Link the document from the backlog, technical plan and task index; retain one canonical roadmap on the current branch.
5. Check Markdown links, task IDs, dependency ordering, documentation-only diff and source-research identity. Open one documentation PR targeting `main`.

## Acceptance

1. `git diff --name-only origin/main` contains documentation paths only; no product or vendor changes.
2. The copied research matches the supplied file byte for byte; its evidence date and caveats remain visible.
3. B22–B26 are existing capabilities, not future implementation. The merged baseline SHA is recorded. Historical tests are attributed to prior implementation and are not claimed to have run for this task.
4. The queue names prerequisites, deliverables, exclusions, effort bands and exit gates. The first four packets identify design outputs, likely module changes and failure fixtures. All unimplemented packets require ready specs before execution.
5. Plan and index links resolve. No circular delivery prerequisites. Every PR targets `main`; English-default/Chinese UI, local data, explicit approvals, Pi reuse and background-only validation remain constraints.
6. Native release work never implicitly opens a production app under background-only authorization. Missing native evidence is an explicit release limitation.

## Risks and open questions

The sequence is proposed, not a fixed calendar or authorization to implement all batches. Exact budgets, schemas, lifecycle states, connector protocol support and routine occurrence behavior must be settled in their owning specs. The roadmap's decision register identifies those owners. Existing documentation may contain historical counts or milestones; they are not new acceptance evidence.

## Verification

Documentation validation and the repository-required `pnpm run check` are recorded in the PR. No product behavior changes; e2e, desktop launches and real-model calls are not part of this documentation-only task.

Checks on 2026-10-18: documentation-only paths; 111 local Markdown links resolved; imported research matched byte for byte; the 26-node proposed dependency map was acyclic; `git diff --check` passed; `pnpm run check` passed 278 tests in 44 files. No e2e, desktop or real-model session was started.

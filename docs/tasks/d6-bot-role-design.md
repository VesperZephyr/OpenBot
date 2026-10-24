# D6: Persistent Roles, Memory and Skills Research

Status: done, merged into main (#45); research complete, no product changes
Branch: task/d6-bot-role-design; pull request target: main
Depends on: accepted D1; merged B6a, D5, B10, B11a and I3
Architecture: Sections 1.1, 4.2, 5.1, 5.7, 5.8 and 7.1

## Goal

Study how Grok Bot connects a persistent role to memory, reusable skills, available tools and continuing work. Recommend an understandable OpenBot product model and the next design packets, building on D5's memory research rather than treating a role as a longer system prompt.

## Scope

In: current official product sources; the previously supplied archived prompt with its provenance; optional static inspection of the installed application package; current OpenBot contracts; a source-backed report with a conceptual object map, concrete user journey, lifecycle decisions and evaluation cases.

Out: product code, new tools or schemas, owner application data, account actions, live Grok task trials, capability isolation, automatic memory extraction, embeddings, unreviewed skill saves, new dependencies, OAuth/model review and Phase 3. This task does not authorize implementing the recommended packets.

## Research contract

Keep official supported behavior, client observations, unverified prompt claims, unknown internals and OpenBot proposals distinguishable. Resolve apparent source conflicts explicitly. A bundled UI type proves a client representation, not backend enforcement or production availability. Do not copy application code, artwork, full prompts or private content into this repository.

Preserve the shared local Mac, Host-owned state and authorization, Pi adapter boundary, reviewed skill revisions and current role management rules. Distinguish skill ownership and default selection from runtime capability and permission. Memory remains guidance; execution receipts and live source systems remain authoritative.

## Steps

1. Verify the merged baseline and read D1, D5, B10/B11a and actual profile, memory and prompt code.
2. Recheck official Grok role, skill, routine, computer and team documentation. Inspect narrowly scoped client metadata only where it can resolve a product question.
3. Write `docs/research/bot-role-design.md` with evidence, unknowns, an OpenBot comparison and proposed behavior across creation, learning, correction, skill reuse and scheduled work.
4. Record proposed implementation packets and decisions without claiming them ready. Link the report from the research index, backlog and technical plan; reconcile B6a/D5's verified merged status.
5. Validate local links and diff formatting, then submit the documentation PR for review.

## Acceptance

1. The report cites dated primary sources and independently labels the archived prompt and any static client evidence.
2. It distinguishes personal Bots, shared account resources, template copies and multi-user Team Bots; unresolved personal skill-selection and memory-sharing semantics remain explicit.
3. It maps identity, memory, skill selection, capabilities, policy and task outcomes to current OpenBot code without claiming planned architecture fields are implemented.
4. A concrete role journey and lifecycle matrix specify observable proposed behavior, including stale corrections, unavailable skills, duplicate/template defaults, group contexts and routine replay.
5. Follow-up packets identify authority, migration, versioning and evaluation decisions; D5, B14d and B14c dependencies are retained.
6. Local Markdown links and `git diff --check` pass. No product test run is required for documentation-only research, and no model-quality claim is made without a real-model experiment.

## Risks

Vendor documentation and client bundles can describe different releases. A plausible prompt or client field cannot establish retrieval algorithms, security guarantees or learning quality. A memory feature can reduce repeated setup while still leaking irrelevant context or preserving a stale belief; evaluate those separately.

## Open questions

Research questions and proposed product decisions will be recorded in the report. They are outputs of this task, not permission to resolve new runtime contracts during implementation.

## Evidence

- [Research report](../research/bot-role-design.md): official product sources rechecked on 2026-10-22; the archived prompt remains an unverified self-report.
- Read-only inspection of installed Grok Bot 0.71.2 establishes client representations for selected fact promotion and template fields; archive paths and SHA-256 prefixes are recorded. No account data, live application calls or copied implementation code.
- Compared merged OpenBot `b04aa77` profile, memory, skill, tool and lifecycle code; proposed object model, role journey, lifecycle matrix and design packets remain distinct from implemented contracts.
- Local Markdown targets and `git diff --check` validated. No product code, dependencies or owner data changed; no full product suites or model-quality benchmarks run for this documentation increment.

### Main integration check (2026-10-23)

Merged `main` at `0ebfc54` into the review branch. Conflict resolution preserves the delivered B27a/B27b/I4/desktop work and the current roadmap; the research report explicitly retains its original dated baseline. Relative to main, this PR remains documentation-only. All 192 local Markdown targets in changed documents and `git diff --check` pass; `pnpm run check` also passes 512 unit/Host tests across 77 files. No additional provider or desktop trial was needed for these documentation resolutions.

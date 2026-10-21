# B6a: Evidence-Based Bot Delivery

Status: in progress
Branch: task/b6a-prompt-reliability
Depends on: I3 (merged in PR #42)
Architecture: Sections 4.4 (prompt sections), 5.1 (routed tools), 5.3 (authorization), 5.7 (memory)

## Goal

Make completion claims, recovery after uncertain effects and delivery of result files explicit in the Bot's working instructions. Reuse current routed tools and approval behavior. Record the remaining prompt research findings without silently enabling new capabilities.

## Scope

In: concise common evidence and trust guidance; capability-dependent connector discovery and artifact guidance; deterministic desktop regression coverage; bounded real-model observation when a configured provider is available; a sourced adoption/defer record.

Out: new tool APIs, memory storage changes, automatic skill or routine creation, quiet routine publication, automatic delegation, browser/computer control, OAuth and model-based approval review. Memory receives a separate design research task, not an implementation in this batch.

## Design and contracts

Keep the existing stable identity, working style, tools, skills and memory sections. Add common rules for verified completion, honest partial/unknown outcomes, read-before-retry of uncertain mutations, untrusted retrieved content and self-contained delivery. Tools remain authoritative for execution results. Prompt instructions are model guidance, not a new security boundary.

Add connector discovery guidance only when `tool_search` is offered, and local artifact guidance only when `artifact_publish` is offered. Respect each tool's supported formats and existing approval semantics. No new tools, schemas, persistence formats, instruction precedence or runtime retry behavior.

The source is the 2026-10-20 Grok Bot self-report archived by phistory, whose completeness and authenticity are unverified. Adapt behavior to the current local OpenBot surface; do not copy proprietary runtime assumptions or treat source text as authority.

## Steps

1. Record this contract and the research adoption/defer matrix.
2. Update `packages/agent-runtime/src/prompt.ts` without changing runtime policy or tool results.
3. Add a ScriptedModel desktop scenario combining source reading, publication failure, corrected publication, immutable preview and restart. Check that source content stays in tool results and optional guidance matches available capabilities at the model boundary.
4. Run check and all background e2e tests, inspect the screenshots, and record observations. Existing I3 tests cover exact denial, unknown remote writes, 429/auth failures and routine recovery.
5. Update backlog and technical plan and open the PR for owner review.

## Acceptance

1. File-only and connector-capable requests receive appropriate guidance; tools absent from the offered set are not advertised by optional sections. Runtime tests exercise the actual rendered model request.
2. A failed publication is visible as failed, successful publication exposes a usable immutable artifact, and preview survives restart: `prompt-reliability.e2e.ts`.
3. Source instructions remain tool data, with common trust guidance in system context; the scripted scenario proves message boundaries and supported UI flow, not model resistance to injection.
4. `pnpm run check` and `pnpm run e2e` pass; I3 continues to assert no unapproved/duplicate confirmed effects. Screenshots are inspected.
5. The research record separates implemented guidance from deferred runtime work. Real-model observations, if run, are reported separately from deterministic tests; no quality or efficiency improvement is inferred from scripted replies.

## Risks

Longer prompts can increase cost and conflicting instructions can weaken behavior. Keep additions short and capability-scoped. A model can still ignore prompt instructions; Host/Router/executor enforcement and receipt reconciliation remain necessary. Changing global guidance can affect routine wording, but every routine occurrence still publishes its durable report.

## Open questions

None for this bounded implementation. Memory design remains research-only.

## Verification

Pending execution.

# I4: Real-Model Role and Memory Acceptance

Status: merged in PR #48; bounded verification and deferred checks are recorded below
Branch: task/i4-role-memory-acceptance; pull request target: main
Depends on: B27a (#46), B27b (#47), B13c and B6a, merged at 0d34b31

## Goal

Verify that the local role/memory foundations help a real model complete useful file work across conversations, corrections and collaboration. Acceptance uses `mafia / claude-opus-5-5` under the owner's model-switch authorization. Record the exact model per trial.

## Scope and contracts

The accepted spending scope is a small real-model smoke check: learning, cross-topic/restart recall and conversational correction. Owner/shared/group cases remain covered by deterministic integration tests; further real-model runs and a real-model retest of fixes are deferred. The runner offers those cases only through explicit `--extended` use.

- Use an isolated, hidden desktop with synthetic invoices, separate state/workspace/Keychain service and a temporary private copy of the owner's existing model configuration. Do not change the owner's application data or model settings. Remove the temporary configuration and close the app after inspection.
- Use the real Host, executor, memory controls, skill library and group routing. Record the actual provider/model, task prompts, observed outputs, independent expected values, interventions, failures and usage. Raw transcripts and temporary artifacts stay ignored; commit only synthetic fixtures, the opt-in runner, summarized evidence and regression tests.
- Separate context delivery from model behavior: inspect model input without logging authorization headers, verify persisted memory and exact skill references, and independently check generated files. A fluent answer is insufficient evidence of successful work.
- Cover natural learning, new-topic/restart recall and conversational correction with a real model. Cover explicit owner correction and protection, explicit shared scope, distinct role defaults and group delegation/review deterministically. Exercise current group contracts: local memory is supplied, shared memory and direct-chat default pins are not implicitly propagated. Record any resulting usability gap rather than silently broadening authority or scope.
- Skills remain reviewed methods under existing authorization. Only approve inspected synthetic task commands whose effects are confined to the fixture workspace; deny unexpected proposals and record the intervention. No external messages, production connectors, cloud services, new grants, provider management changes or Phase 3 work.
- Fix reproducible defects in these existing contracts and add deterministic regression coverage. Real-model retests remain deferred under the spending limit. Architectural changes or new capability scopes require an explicit design amendment in Open questions.

## Steps

1. Prepare a reusable invoice fixture and independent oracle, two distinct reviewed skill procedures and a bounded opt-in real-model runner.
2. Run the real scenarios, preserving failures and distinguishing first-pass results from assisted retries. Inspect the hidden desktop with agent-browser and screenshots.
3. Fix observed product defects with meaningful unit/Host and ScriptedModel regression tests. Record unperformed real-model retests explicitly.
4. Run `pnpm run check` and full background `pnpm run e2e`; inspect screenshots and record evidence and remaining limitations.
5. Update current-state/backlog, commit and push this task branch, open a PR and verify CI. The owner merges.

## Acceptance

1. A remembered policy changes independently verified report values after a fresh topic and full desktop restart, without restating the policy in the work request.
2. Real conversational correction affects subsequent work; deterministic checks verify owner correction and protection against stale writes. Source evidence identifies the actual learning context.
3. Deterministic integration verifies another role receives deliberately shared facts and keeps separate local notes/default methods; real shared-role review is explicitly deferred.
4. Deterministic integration verifies a bounded delegation/review chain with durable results after restart; real group collaboration is explicitly deferred.
5. Failures have regression coverage and successful retests, or are explicitly documented as unresolved with precise evidence. No fabricated model-quality or native-release claims.
6. Full automated checks, opt-in real-model results, screenshots, cleanup and exact candidate/model are recorded.

## Open questions

None at admission. Long-history retrieval, semantic contradiction detection and automatic group skill propagation are outside the existing contracts and must not be inferred from this acceptance task.

## Findings and verification

[Evidence](../acceptance/role-memory-2026-10-22.md) records correct USD 2,200 → USD 1,600 real outputs after memory correction, the model's unrequested v1 → v2 method substitution, clarified selected-version precedence, three deterministic integration scenarios, infrastructure failures and the unperformed real-model retest. Stored pins and authorization are unchanged. Final full checks are recorded in the PR before readiness.

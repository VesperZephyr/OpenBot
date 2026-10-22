# I4: Real-Model Role and Memory Acceptance

Status: ready for execution
Branch: task/i4-role-memory-acceptance; pull request target: main
Depends on: B27a (#46), B27b (#47), B13c and B6a, merged at 0d34b31

## Goal

Verify that the local role/memory foundations help a real model complete useful file work across conversations, corrections and collaboration. The owner selected `mafia / gpt-6.1-sol` after the configured gateway catalog did not list M3.1. Do not substitute another model silently.

## Scope and contracts

- Use an isolated, hidden desktop with synthetic invoices, separate state/workspace/Keychain service and a temporary private copy of the owner's existing model configuration. Do not change the owner's application data or model settings. Remove the temporary configuration and close the app after inspection.
- Use the real Host, executor, memory controls, skill library and group routing. Record the actual provider/model, task prompts, observed outputs, independent expected values, interventions, failures and usage. Raw transcripts and temporary artifacts stay ignored; commit only synthetic fixtures, the opt-in runner, summarized evidence and regression tests.
- Separate context delivery from model behavior: inspect model input without logging authorization headers, verify persisted memory and exact skill references, and independently check generated files. A fluent answer is insufficient evidence of successful work.
- Cover natural learning, new-topic/restart recall, conversational correction, explicit owner correction and protection, explicit shared scope, distinct role defaults and real group delegation/review. Exercise current group contracts: local memory is supplied, shared memory and direct-chat default pins are not implicitly propagated. Record any resulting usability gap rather than silently broadening authority or scope.
- Skills remain reviewed methods under existing authorization. Only approve inspected synthetic task commands whose effects are confined to the fixture workspace; deny unexpected proposals and record the intervention. No external messages, production connectors, cloud services, new grants, provider management changes or Phase 3 work.
- Fix reproducible defects in these existing contracts and add deterministic regression coverage before repeating the failing real scenario. Architectural changes or new capability scopes require an explicit design amendment in Open questions.

## Steps

1. Prepare a reusable invoice fixture and independent oracle, two distinct reviewed skill procedures and a bounded opt-in real-model runner.
2. Run the real scenarios, preserving failures and distinguishing first-pass results from assisted retries. Inspect the hidden desktop with agent-browser and screenshots.
3. Fix observed product defects with meaningful unit/Host and ScriptedModel regression tests. Re-run affected real cases.
4. Run `pnpm run check` and full background `pnpm run e2e`; inspect screenshots and record evidence and remaining limitations.
5. Update current-state/backlog, commit and push this task branch, open a PR and verify CI. The owner merges.

## Acceptance

1. A remembered policy changes independently verified report values after a fresh topic and full desktop restart, without restating the policy in the work request.
2. Conversational and owner corrections affect subsequent work; protected topics resist stale writes. Source evidence identifies the actual learning context.
3. Another role receives deliberately shared facts, keeps separate local notes/default methods and produces a useful independently checked review artifact.
4. A real group task completes a bounded delegation/review chain with verifiable files and durable results after restart; actual skill use and scope limitations are reported.
5. Failures have regression coverage and successful retests, or are explicitly documented as unresolved with precise evidence. No fabricated model-quality or native-release claims.
6. Full automated checks, opt-in real-model results, screenshots, cleanup and exact candidate/model are recorded.

## Open questions

None at admission. Long-history retrieval, semantic contradiction detection and automatic group skill propagation are outside the existing contracts and must not be inferred from this acceptance task.

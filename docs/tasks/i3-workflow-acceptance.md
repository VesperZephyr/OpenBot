# I3: Repeatable Workflow Acceptance

Status: done (#42)
Branch: task/i3-workflow-acceptance; PR target: main
Depends on: merged main `19893ac` (B11a, PR #41), B9a/b, B10, B12a, B13d, B14a/b/e, B15a/b
Architecture: Sections 5.6, 5.8, 7 and 8; P1 delivery gate in the development roadmap

## Goal

Prove that the existing application can read business records, research supporting material, produce a verified report, perform an exactly approved update, retain a reviewed procedure and reuse it in an isolated routine. Measure the useful outcome and recovery without claiming that a completed model turn proves a completed external operation.

## Scope

In: a synthetic CRM MCP service, deterministic desktop acceptance, bounded real-model verification, sanitized evidence and repairs within existing contracts if acceptance exposes defects.

Out: new orchestration or scheduling features, OAuth (B9c), optional model review (B12b), Phase 3, backup/restore, production CRM access, new automatic grants, merging and release publication. Native signed release gates remain separate.

## Design

Use the real hidden Electron app, Host, Tool Router and executor with an isolated workspace and Keychain service. A loopback TLS MCP fixture owns synthetic accounts and an independent effect ledger. A search-provider fixture returns a referenced synthetic policy page; its complete captured text is also a local input. The deterministic suite uses that capture and labels it as such. Production `web_fetch` must continue refusing loopback addresses; do not add a test bypass to Host composition. A bounded real-model spot check separately fetches an actual public reference page and records whether retrieval succeeded. This keeps CI independent of public-network availability while distinguishing search leads, captured sources and live retrieval.

The first report joins CRM accounts with local invoice rows. The user rejects an initial update, supplies the correction, approves the exact corrected write, then reviews and saves the procedure. Reuse pins that skill revision and reads changed inputs. Each injected failure retains any verified artifact while stating which external operation is incomplete or uncertain. Ordinary connector approvals also apply to reads and unattended runs.

## Contracts

1. No changes to public protocol, storage formats, package boundaries or Pi. Existing target policy, exact connector revision/schema approval and executor receipts remain authoritative.
2. The fixture exposes bounded `list_accounts` and `update_account` tools. Updates include account ID, expected record version and risk. Its ledger records every accepted effect; a response-loss mode applies one effect and drops the response without claiming idempotency. Auth and rate modes reject before applying an effect. Fixture state is separate from OpenBot state.
3. Every assertion uses actual file bytes, artifact previews, approval bindings, receipt/transcript states, routine occurrence IDs and the independent fixture ledger. Scripted prose alone is never proof of a side effect or calculation.
4. Denial has zero effects. A Host restart preserves a pending exact approval and its deadline; disconnected connectors require explicit reconnection. Confirmed effects and published routine reports never duplicate after restart. Response loss remains interrupted/attention-needed, with no automatic retry.
5. The skill records source validation, version checks, approval boundaries and explicit partial/unknown outcomes. Routine configuration pins its exact name, revision and digest. New input is read afresh; previous private conversation content is not required.
6. Write a sanitized local evidence manifest under ignored `e2e/.run/` with candidate SHA, scenario outcome, elapsed milliseconds, interventions, observed tool requests/effects, retries, reported tokens and known cost or `null`. Commit only an aggregate evidence record with no credentials, provider identity, private endpoint, raw transcripts or execution logs.
7. Check English and Chinese results/approvals in the background app. Observe it with agent-browser. Real-provider checks use synthetic inputs and the same fixture, have bounded duration, and clean up isolated credentials. No owner workspace or application data is modified.

## Steps

1. Save this spec, record B11a as merged and open the task branch/PR.
2. Add the CRM and search fixtures and integrated desktop scenarios, including denial/correction, skill reuse, changed input, restart, 429, revoked auth and lost response.
3. Run focused acceptance, inspect screenshots and explore the isolated app. Repair only demonstrated defects within existing contracts and add regression coverage.
4. Run `pnpm run check` and the complete background `pnpm run e2e`. Perform one bounded real-model workflow and verify independent effects and outputs.
5. Record metrics and limitations; update backlog, technical plan and task index. Push the reviewable candidate, follow CI and leave merging to the owner.

## Acceptance

1. `workflow-acceptance.e2e.ts` reads CRM and local sources, obtains a search reference, creates a verified artifact, denies a write without effect, and approves exactly one corrected update.
2. The same suite reviews/saves a skill and pins it in a confirmed routine; changed input produces a new verified artifact, with normal unattended approvals and one durable direct-chat report.
3. Failure scenarios exercise HTTP 429, revoked auth, Host restart and a lost write response. The independent ledger proves zero unapproved effects and zero duplicate confirmed effects; visible partial/unknown results and retained artifacts survive restart.
4. The suite writes sanitized measured evidence; full check/e2e pass, English/Chinese screenshots are inspected and agent-browser exploration is recorded.
5. A bounded real-model synthetic workflow records actual source retrieval, verified report/effect counts, interventions and available usage. Any provider failure or unavailable estimate is explicit; this is a spot check, not a quality benchmark or native release certification.

## Risks

Native lock/sleep may interrupt background verification through the real lifecycle gate; report and rerun without disabling the gate. Network/provider failures can leave useful partial output; never repeat an uncertain write to make acceptance appear successful. Test routines must be paused/cleaned up and their connector removed after verification.

## Open questions

None.

## Evidence

[Acceptance record](../acceptance/workflow-2026-10-20.md): 477 unit/Host tests and 131 hidden desktop tests pass. Four integrated scenarios verify report arithmetic, correction/denial, reviewed skills, changed-input routine reuse, Host recovery and connector failure outcomes. A bounded real-model sequence verifies both report versions and exactly two approved updates; public reference retrieval failed visibly, with the supplied capture used explicitly. English/Chinese screenshots and agent-browser report previews were inspected. No production behavior or protocol changed.

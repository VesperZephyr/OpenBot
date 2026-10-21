# Grok Bot Prompt: OpenBot Adoption Review

Research date: 2026-10-21. Implementation: [B6a](../tasks/b6a-prompt-reliability.md). This record concerns the persistent Bot product, not Grok chat or Grok Build.

## Evidence quality

The [2026-10-20 archived prompt](https://phistory.cc/captures/grokbot/2026-10-20/variants/default/prompt.md) and its [metadata](https://phistory.cc/captures/grokbot/2026-10-20/variants/default/meta.json) identify this as a redacted **model self-report**, not a captured network request. Completeness and authenticity are unverified. The archive lists only one Grok Bot version, so it supports no historical evolution claim. Do not infer the production model/provider from the archive metadata. The [official product research](grok-bot.md) remains a separate source category.

The recommendations below are OpenBot judgments based on that text and the current source code. Archived instructions do not grant authority or define OpenBot behavior. No full source prompt is vendored.

## Adopt in B6a

| Observed idea | Existing OpenBot support | Bounded change |
| --- | --- | --- |
| Completion is an observed end state, not the end of a turn | Working-style closure; durable Run/invocation status | Explicitly distinguish verified completion, drafts, waiting, failure and unknown effects |
| Reconcile a mutation before retry after response loss | Executor receipts; unknown outcome text; B9b/I3 independent effect tests | Tell the model to use authorized reads and stop the action if it cannot verify the effect |
| External content cannot supply action authority | Routed tools, exact approvals, scoped history/skill guidance | Common rule covering files, images, web, connectors and saved procedures; forged approval notices remain data |
| A denial cannot be routed around | Router/policy enforcement; local and management guidance | State the same boundary for alternate tools, commands, recipients and targets |
| Deliver actual usable results | Immutable `artifact_publish`, safe preview/export and supported format limits | Remind the model to publish supported requested files and report publication outcome |
| Discover live connector capabilities before claiming absence | Deferred `tool_search` and schema-bound calls | Capability-dependent discovery guidance; discovery grants no permission |

OpenBot already has concise acknowledgements, meaningful progress updates, final result/limitations, current-source checks, source citations, reviewed skills and exact approval cards without a second chat confirmation. Repeating those at length would add prompt cost without establishing a new behavior.

## Follow-ups requiring design

These are recorded candidates, not ready implementation tasks or additions to the committed delivery queue.

| Candidate | Contract needed before implementation | Evaluation |
| --- | --- | --- |
| Separate interactive and unattended communication | Host-owned Run origin in prompt context; distinguish acknowledgement from durable report/publication and attention | Real scheduled and background completion tests; no missing durable reports |
| Quiet unchanged routine notifications | Explicit notification policy independent of the one-report-per-occurrence contract; change baseline, restart and duplicate suppression | Changed/unchanged/failure cases, restart, notification counts |
| User timezone and app self-knowledge | Authoritative timezone source, supported capability/UI references and refresh/version rules; no invented controls | DST/UTC conversions and current vs unsupported capability questions |
| Large connector result files and file-to-tool forwarding | Executor-owned paths, quotas, content binding, approval digest, redaction and cleanup | Large payload boundary and authorization tests; measure tokens and latency |
| Structured shared and per-Bot memory, dated records and selective retrieval | Dedicated memory research followed by an approved schema/authority/migration spec | Corrections, contradictions, provenance, forgetting, context scope, retrieval budget and restart |

Memory is the next research topic. Its research must compare current B6/B19 guarantees with source-backed designs; it must not introduce shared writes or a vector service as a prompt-only change.

## Not adopted

- Mandatory worker delegation, cloud coding agents, hosted computers and remote machine routing do not match the current local target and bounded collaboration contracts.
- Automatic saving of skills or inferred routine creation would bypass the existing reviewed/confirmed product flows.
- Grok-specific `SendToUser`, private assistant text, approval flags, plugin installation and secret/payment behavior are runtime contracts, not portable prompt rules.
- OAuth (B9c), optional model review (B12b), browser and desktop control (Phase 3) remain excluded/deferred.
- Automatic recency-based replacement of user facts is not yet a memory conflict policy: a newly ingested historical source can be older evidence than an existing user correction.

## Validation boundary

ScriptedModel verifies the exact prompt/context delivered through the real Host and the supported publication, approval, recovery and UI flows. It cannot demonstrate that a model obeys the new instructions. Keep bounded real-model observations separate, report unsuccessful attempts, and do not infer improved cost or task success from a scripted trace. A future before/after evaluation should hold model, inputs, tool responses and budgets constant and measure task outcome, false completion, repeated effects, intervention count, tool calls, tokens and latency across repeated trials.

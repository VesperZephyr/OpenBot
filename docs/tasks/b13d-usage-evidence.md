# B13d: Local Usage and Execution Evidence

Status: ready
Branch: task/b13d-usage-evidence; PR target: main
Depends on: merged Runs, B13c channels, B24–B26 receipts
Architecture: Sections 2.3, 5.1, 6.2 and 8

## Goal

Let the user inspect a Bot's recorded model usage and recent tasks, connect a task to its conversation result and approvals, and understand when a cost estimate is unavailable. This is local execution evidence, not billing or telemetry.

This independent increment starts from merged `main`. Lifecycle, artifacts and deterministic-policy PRs remain separate; their future integration must preserve the same Run admission/settlement boundaries.

## Scope

In: read-only per-Bot and recent-Run usage, actual provider/model attribution, known-rate USD estimates, local result and approval references, English/Chinese details UI, deterministic and real-model verification.

Out: new model tools or Code Mode APIs, budgets/billing, remote analytics, scraped prices, provider invoice reconciliation, artifact imports, new scheduling/cancellation, group-wide billing, unlimited history UI and vendor updates.

## Accounting contract

Pi's conversation-scoped `UsageDoc.models` is the source of recorded generation and compaction counters. Do not sum transcript responses, live deltas, tool results or Code Mode children into it again. Pi records usage atomically with provider response/compaction settlement; OpenBot must not add its own inference loop. Report recorded counters, not a guarantee of every provider-billed request: an interrupted response without committed usage is unknowable.

The adapter maintains a version-1 session document `openbot.usage-evidence`. Before a Run first becomes running, atomically with its Run record, persist its conversation ID and baseline model counters. On terminal settlement, in the same Run transaction, capture current counters, subtract the baseline, freeze the result and add it once to per-Bot accounted totals. A repeated put or recovery cannot reset a baseline, re-finalize a settled record, or add a second copy. Running reads subtract from the persisted baseline without mutating totals. Steers share the same Run; group contexts use their own Pi conversation. Sequential admission prevents later Runs from leaking into an earlier settled interval. Failed and cancelled Runs retain committed usage.

Existing completed Runs have no interval and show unavailable, rather than inferring boundaries from timestamps. Existing running Runs without a baseline also show unavailable; a replay cannot manufacture a fresh zero baseline. Per-Bot totals read all of that Bot's direct/group Pi model ledgers, including usage older than retained Run history. Accounted cost totals remain durable after recent Run details are pruned. Keep detail retention aligned with the existing 50 direct terminal Runs/Bot and retained group Run identities. New topic does not reset accounting.

Model buckets contain input, output, cache read/write, total tokens, optional reasoning/cache-write-1h counters, and Pi's estimated USD cost. Reasoning is a subset of output and is never added again. A zero-only/missing counter set is shown as unavailable; this provider path cannot distinguish missing usage from a genuinely empty generation. The UI labels all numbers as recorded usage. Tool buckets are excluded from model totals; current Code Mode tools report no independent provider generation.

## Price and source provenance

At Run admission capture the selected model's provider/model key, source (`builtin`, `configured`, or `unknown`), and whether rates are usable. Built-in catalog nonzero rates are estimates. A configured provider, including a built-in overlay, needs explicitly complete finite nonnegative input/output/cacheRead/cacheWrite rates; inferred catalog costs or default zeros are not proof of gateway prices. An explicitly configured all-zero schedule is known and may show $0.

Use the delta of Pi's committed cost counters only when the bucket matches that admission model and its pricing configuration is still unchanged. Capture an opaque process/configuration epoch; changing model configuration/selection or restarting during an active interval makes its cost unavailable, while completed frozen costs never change when settings change. This deliberately conservative rule avoids repricing old requests at today's rates. Unknown/mixed rates never become an overall zero estimate. Per-Bot cost is available only when the entire Pi model counter total is covered by priced settled intervals; otherwise show unavailable (active/unattributed/legacy usage included). No endpoint URL, API key, header or credential reference appears in evidence.

## Read API and UI

Add desktop-only `usage.get({ botId, limit? })`: limit 1–50, default 10. Validate the Bot exists and is not deleted; a model cannot invoke this Host method through a generic bridge. The result contains total counters, optional estimated USD, up to 100 model buckets with a truncation flag, and recent Run records with identity/state/time, recorded usage and local evidence references. Aggregate all counters before truncating display buckets. No task prompts, tool arguments, outputs or secret values are copied into the usage response or logs.

Run evidence uses authoritative input submission answer IDs and tool call/approval identities from its bounded entry interval, never model-supplied paths. Return at most 20 result/tool references per Run, with a truncation indicator. Private results link to the existing timeline navigation; group Runs link to their group conversation/publication when available, without exposing a private result as a group post. Missing/pruned evidence is labeled unavailable. Approval references show identity/state and link to the associated tool in the conversation, not an approval-grant action.

The Bot details panel has a collapsed Usage and tasks section, with refresh, loading/empty/error states, totals and recent task rows. Open a task to inspect model buckets and evidence links. English defaults; all new labels and unavailable explanations have Simplified Chinese translations. Reuse existing conversation navigation and attention states. Reading usage never marks a conversation read; navigation follows existing rendered-timeline rules.

## Steps

1. Protocol types/schema/renderer allowlist; pure bounded counter arithmetic and pricing classification tests.
2. Adapter document and atomic Run admission/settlement capture; old-store/repeated-put/restart/compaction tests. Keep Pi types inside agent-runtime.
3. Read-only Host projection and bounded evidence links; authorization, model/configuration change and no nested usage duplication tests.
4. Bilingual details UI and ScriptedModel usage fixture; hidden e2e for exact usage, approval/result navigation, known/unknown rates, restart and new topic.
5. Full `pnpm run check`, full background `pnpm run e2e`, screenshot inspection and a bounded hidden real-model task. Record counters and local execution result, remove temporary model configuration; publish one PR targeting main.

## Acceptance

1. Admission and terminal snapshots are atomic with Runs; retry, restart and repeated read/put never duplicate totals. Independent Bot/group contexts stay distinct; steering remains one interval. Recent-detail pruning preserves Bot totals. Legacy intervals remain unavailable.
2. Known configured rates, explicit zero rates, unknown gateway rates, changed model/price epoch and new-topic/restart cases are covered. Reasoning and Code Mode child tools are not added twice; compaction uses the Pi ledger.
3. The Host rejects unknown/deleted Bots and invalid limits; evidence payloads exclude prompt, arguments, results, endpoints and credentials. Result/approval references cannot target another Bot's interval.
4. Background e2e obtains scripted usage through real HTTP/Pi, approves a tool, opens its result, reads English/Chinese usage and restarts without changing settled counters. Missing/zero usage reads unavailable.
5. Full check/e2e, screenshots and one isolated real-model spot check pass. No native dialogs, focus changes, notifications, telemetry or owner data are involved.

## Open questions

None for this increment. Per-request billing reconciliation and attribution of active Runs across changed pricing epochs are deliberately unavailable, not estimated. Future independent model tools need their own accounting contract before adding tool usage to these totals.

# B27c product acceptance — 2026-11-01

Candidate: `task/b27c-bounded-memory-retrieval`, [PR #77](https://github.com/VesperZephyr/OpenBot/pull/77), based on `139e12d` (merged design PR #76). The [spec](../tasks/b27c-bounded-memory-retrieval.md) owns the contract and delivery status. This record describes the opt-in candidate, not a merged release or a default change.

## Product evidence

Placement and governed reads use the existing memory documents, Host router and Pi conversation. Default-always notes retain their prompt/tool behavior. Owner placement does not confer factual protection, and ordinary edits, scope moves, history and backup restore preserve the specified placement semantics. No new store, index, package, dependency or background extraction was added.

Deterministic coverage includes the frozen 18 literal positives, five absence/suppression cases and 15 explicit paraphrase/translation/normalization misses; ordinal ordering and response byte bounds; Unicode chunks and strict structural references; current revisions, scope suppression, cancellation, sanitization and missing registration. Runtime tests exercise direct/background/routine reads and actual user/peer/result group deliveries, including dissolution and ancestor failure before asynchronous delivery reconciliation. They distinguish committed Pi result replay (original observation, no handler re-execution) from actual bound handler calls after correction and reopen (current authority and stale-reference rejection). Router tests deny before dispatch and recheck stopped authority after approval. Prompt tests keep both read tools available only in selective contexts and do not load omitted content after denial.

The Memory and backup e2e suites cover conflict-preserved placement drafts, model-origin provenance, live correction, historical context retention, reset, restart and local/shared backup recovery. English and Chinese hidden-app screenshots were inspected, including the 880×560 window. Agent-browser exploration of the isolated app verified selection, Save placement and the changed projection estimate. No owner application or owner memory was used.

Verification on this Mac:

- `pnpm install --frozen-lockfile` and `pnpm run build:pi` passed; vendored sources were unchanged.
- `pnpm run check`: 102 files / 704 tests passed, including boundaries and both TypeScript projects.
- The first two full `pnpm run e2e` runs each passed 211/212; an unchanged isolated `message-activity` rerun passed all five tests. The Retry test counted its expected message immediately after a live Retry control appeared. Failure screenshots still showed “Preparing history,” while the canonical database already contained the exact `openbot.bot-message`. The assertion now polls for that same message row, accommodating the asynchronous history projection without weakening the expected count or changing B28a product behavior/design.
- A subsequent full run passed the Retry assertion but failed the existing macOS Dock-hidden assertion in `background.e2e.ts` (211/212). Its window visibility/focusability checks passed. The final full run after the group ancestor-invalidation regression passed **54 files / 212 tests**. Shard timings were refreshed from that complete JSON report.
- `git diff --check` passed. No packaging/native-permission changes require a signed build for this increment.

Raw synthetic provider requests, answers, UI screenshots and runtime outputs remain ignored under `e2e/.run/`; no credential values or execution logs are committed.

## Bounded actual-product comparison

Runner: [`scripts/acceptance/memory-retrieval.mts`](../../scripts/acceptance/memory-retrieval.mts). It launches the real isolated Electron application and forwards its actual provider-bound prompt and full tool schemas to the explicitly selected configured provider/model. The reference question set and active note bodies come from the [frozen design fixture](../research/fixtures/b27c-retrieval.mjs); the standalone research search/read implementation is not used by the product runner. Owner APIs change placement between arms, and each ordinary trial resets model context. The shared forgotten-topic marker preserves suppression. Model-origin local notes for the sensitivity arm are seeded through the runtime's bound learning method, then made on demand through the owner method; they remain unprotected.

Configured model: `mafia / claude-opus-5-5`, Anthropic Messages. Limits were 70 main requests including warm-prefix observations, ten sensitivity requests, 768 output tokens per request and three retrieval rounds per trial. The proxy stops forwarding after a provider/transport failure; it never retries. Results used **45 main requests (43 paired + two warm) and seven sensitivity requests**, all successful. No budget was extended or answer case repeated after seeing a quality failure.

Two runner preflight attempts sent **zero upstream requests**: the initial seeded Bot had no model, then the proxy rejected the SDK's query-bearing Messages URL before dispatch. The runner now binds the selected model and validates the URL pathname. Neither attempt contributes to quality or usage results. The complete comparison is the single `b27c-product-comparison-v2/product-comparison.json` evidence run.

### Quality

Both arms passed all ten recall questions, both unrelated tasks and both absence questions. Manual review confirmed the current facts and constraints: dry-run/review dates, RMB/CNY 680 including tax and excluding breakfast, rooibos with caffeinated tea excluded, Hong Kong rather than a delivery address, strictly more than 20 overdue days with paid invoices excluded and USD retained, shared Warehouse Maple precedence, and final cabinet code IRIS-93. The absent passport answers did not invent a number. The English review-date baseline additionally suggested 2026 as an explicitly uncertain inference; the stored note itself contains no year.

The selective long-note trial performed one search and two reads: offsets 0 and 2048, with 2,048 and 290 body bytes, then `complete: true`. It used four provider requests, exactly the maximum of three retrieval rounds. The two bilingual holdouts also passed; the Chinese delivery holdout needed two search rounds.

Both paired unprotected-local sensitivity cases passed. The selective first request contained neither the local residence nor collections title in its protection guidance. Residence used two searches in one round; collections used three searches across two rounds. Their selective/all-loaded input totals were 16,478/9,452 and 25,152/9,462 respectively. Placement did not add owner protection or expose those titles as metadata.

### Value, usage and cache

Input below includes ordinary input, cache-read and cache-creation tokens. It counts the actual product schemas, prompts, protection names, repeated history and tool results. Times are observed end-to-end trial durations, not a latency guarantee.

| Main workload, 14 tasks per arm | All-loaded | Selective |
| --- | ---: | ---: |
| Provider requests | 14 | 29 |
| Input tokens including cache | 134,711 | 242,122 |
| Output tokens | 1,495 | 2,432 |
| Cache-read input tokens | 56,069 | 180,382 |
| Cache-creation input tokens | 78,586 | 61,654 |
| Summed trial time | 56.009 s | 94.255 s |

Both unrelated tasks used one request and no memory tool calls in each arm. English input was **9,614 → 8,110**; Chinese input was **9,619 → 8,115**: each saves **1,504 tokens**, exceeding the 1,000-token marginal gate with full product overhead. This is about 15.6% of these complete requests, not the research harness's whole-prompt percentage.

The mixed workload instead consumed **79.7% more input** and **68.3% more elapsed time** under selective loading. Recall needs to pay for tool results and further generations; this evidence does not support general cost or latency savings. Defaults remain always-loaded, and important preferences should stay there.

The immediate repeated arithmetic question measured warm prefixes separately. All-loaded used 9,637 input / 27 output tokens, of which 9,610 input tokens were cache reads and 23 were cache creation, in 1.877 s. Selective used 8,133 input / 19 output, with 8,106 cache reads and 23 cache creation, in 2.000 s. Both used one request and no tools. These are provider-reported cache tokens; effective cache prices, billing and dollar savings remain unknown. Arm ordering alternated for the main trials; this small sample cannot establish cache economics across workloads.

Existing-context retention is separately demonstrated by the scripted e2e: moving/correcting an on-demand note leaves its previously supplied tool result in the old context; New topic omits that history and the current on-demand body. Placement is context selection, not erasure.

## Reproduction and remaining limits

After dependencies and the desktop build, opt into the bounded runner with an existing configured provider/model:

```sh
node scripts/acceptance/memory-retrieval.mts --run --provider <configured-provider> --model <configured-model> --name <new-isolated-evidence-directory>
```

Do not reuse the result as a promise for other models, larger corpora or semantic search. The literal matcher deliberately misses unsupported paraphrases; model-guided reformulation costs additional requests and is not guaranteed. No real owner data, provider billing audit, native signing or full data-erasure validation was performed. The final local run passed both the activity and background-presentation suites. The initial remote CI at `0aae79a` passed check/history performance but failed existing HTTPS rate-limit and template clock fixtures: the short Retry-After deadline elapsed across relaunch, and `clock.pauseAt(new Date())` attempted to move a running test clock backwards. Later tests in those files then failed after incomplete cleanup. Those fixtures were unchanged in this PR; check the latest PR head before treating remote CI as green.

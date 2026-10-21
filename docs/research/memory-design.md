# Local Memory: Research and Proposed Direction

Research date: 2026-10-21. Status: design proposal, not an implementation contract. Baseline: merged I3 (`50c58f1`) and B6/B19 memory. [D5](../tasks/d5-memory-research.md) records this research task. The [architecture](../architecture.md) remains authoritative.

## Recommendation

Keep a small, inspectable set of current facts in context; retrieve dated evidence when the task needs it. Separate **who may use a fact**, **what kind of knowledge it is**, and **how it enters model context**. These are independent dimensions. Do not turn Grok's four memory labels into four unrelated stores, and do not start by increasing the existing 8 KiB limit or adding a remote vector database.

First design record-level provenance, explicit corrections and forgetting. Then design shared user facts and bounded retrieval. Retain Host-owned writes, revisions and replay receipts. Reviewed skills already represent reusable procedures; routine results and execution receipts already record outcomes. Memory should link those sources rather than manufacture a second authoritative history.

## What OpenBot actually does

| Area | Verified implementation | Consequence |
| --- | --- | --- |
| Storage | `agent-runtime/src/memory.ts`: `openbot.memory`, session-scoped by Bot, 8,192 UTF-8 bytes of Markdown | Small, transparent and local; all facts compete for the same budget |
| Context | `agent-runtime/src/prompt.ts`: current memory rendered into a system section on requests | No selective memory retrieval; larger memory increases model context even for unrelated tasks |
| Updates | `BotRuntime.editMemory`, `setMemory`, `restoreMemory`: atomic expected-revision checks and bounded history | User corrections survive stale concurrent writes and durable call replay |
| Provenance | Source (`user`, `model`, `restore`, `legacy`) and timestamp belong to the entire snapshot | One cannot reliably identify which message supports an individual sentence |
| History | Current snapshot plus at most 20 previous snapshots; restore creates a revision | Useful undo, not an episodic memory database or full-data erasure |
| Deduplication | `applyMemoryEdit` appends only when the section does not already contain the submitted substring | Textual idempotence is not semantic identity, contradiction resolution or fact-level correction |
| Scope | One Bot's direct, group and routine contexts share its memory; no Core cross-Bot memory tool | Shared Mac access does not mean a shared structured user profile; context minimization needs explicit future contracts |
| History search | B24/B25 Core application tools search retained conversation text literally, with group scope checks | Existing evidence access should be reused where authorized; it is not a general memory search tool for every Bot |
| Controls | B19 bilingual editor, conflict-preserved drafts, clear, preview/restore, empty-memory duplication | Preserve these controls during any migration |
| Deletion | Clear changes current memory; prior chat/model context, Pi journal and backups may retain facts | Never label this complete erasure; restoring an old backup can revive old data |

Sources: [B6](../tasks/b6-bot-quality.md), [B19](../tasks/b19-memory-controls.md), [architecture 5.7](../architecture.md#57-bots-memory-group-chats-and-handoff), [storage/section edits](../../packages/agent-runtime/src/memory.ts), [runtime mutation/context code](../../packages/agent-runtime/src/index.ts), [prompt projection](../../packages/agent-runtime/src/prompt.ts), [scoped history access](../../packages/server-core/src/app-capabilities.ts) and [memory-control tests](../../packages/agent-runtime/test/memory-controls.test.ts). This is a code review, not a claim that the current model always remembers correctly. Current memory is sent to the configured inference endpoint as context; local storage does not imply offline inference.

## External evidence and its limits

| Source | Useful observation | OpenBot interpretation |
| --- | --- | --- |
| [Grok Bot archived self-report, 2026-10-20](https://phistory.cc/captures/grokbot/2026-10-20/variants/default/prompt.md), [metadata](https://phistory.cc/captures/grokbot/2026-10-20/variants/default/meta.json) | Labels distinguish profile/journal and own/shared memory; source attribution and recency guide conflicts | Product ideas only. The self-report is unverified, not an official captured runtime contract. Ingestion recency alone is unsafe for corrections |
| [LangGraph memory concepts](https://docs.langchain.com/oss/python/concepts/memory) | Separates conversation state from long-term namespaces, facts from experiences/procedures, and profile from record collections; discusses inline vs background writes | A compact profile simplifies context; record collections make provenance and retrieval possible but add deduplication/update complexity. This does not require adopting LangGraph |
| [Letta MemFS](https://docs.letta.com/concepts/memfs), [shared memory](https://docs.letta.com/concepts/shared-memory) | Current documentation uses Git-backed files, root context and indexed directories loaded on demand; default MemFS has no vector index. Shared repositories are described for cloud-hosted agents | Borrow bounded context and readable organization. Do not import Git/cloud synchronization or ordinary file writes as OpenBot's authority path |
| [Letta V1 blocks](https://docs.letta.com/v1-sdk/memory/memory-blocks), [V1 archival memory](https://docs.letta.com/v1-sdk/memory/archival-memory) | Legacy API distinguishes always-present blocks from on-demand archival search | These are explicitly V1/legacy docs, not a description of the current MemFS implementation. The separation remains a useful design comparison |
| [MemGPT](https://arxiv.org/abs/2310.08560), v2 | Studies management of limited context across memory tiers | Supports evaluating a bounded working set plus external records, not a claim of guaranteed recall or a need to replace Pi |
| [LongMemEval](https://arxiv.org/abs/2410.10813), v2; [official repository](https://github.com/xiaowu0162/LongMemEval) | Evaluates extraction, multi-session reasoning, temporal reasoning, knowledge updates and abstention; distinguishes indexing, retrieval and reading | Adopt these test categories. Do not transfer published scores to OpenBot or equate retrieval recall with correct answers |
| [SQLite FTS5](https://www.sqlite.org/fts5.html#the_trigram_tokenizer) | Tokenizer choice changes matching; trigram MATCH cannot match fewer than three Unicode characters | Chinese names and short terms need an explicit strategy. Local lexical search is an experiment to measure, not an assumed complete solution |

These pages were retrieved on the research date. No external memory product or embedding service was installed, and no personal histories were uploaded. Papers/documentation provide design evidence; vendor capability claims are not comparative OpenBot benchmarks.

## A small reproducible retrieval probe

Run `node docs/research/fixtures/memory-retrieval-probe.mjs`. It creates an in-memory database with four synthetic notes and prints matches for seven queries. It has no dependency on OpenBot data, credentials, model APIs or new packages. The bundled Node can run the same file.

Observed on development Node 22.22.2 / SQLite 3.51.2 and the existing packaged Node 24.22.0 / SQLite 3.53.4: identical matches.

| Query | unicode61 MATCH | trigram MATCH | Literal substring |
| --- | --- | --- | --- |
| `coffee` | English drink note | English drink note | English drink note |
| `caffeine` | None | None | None |
| `咖啡` | None | None | Chinese drink note |
| `不喝咖啡` | None | Chinese drink note | Chinese drink note |
| `香港` | None | None | Chinese city note |
| `concise` | Style note | Style note | Style note |
| `short` | None | None | None |

This probe establishes matching behavior only. The short Chinese terms expose a concrete tokenizer limitation. The `short`/`concise` pair exposes vocabulary mismatch. `caffeine` is merely a related query: avoiding coffee does not establish avoidance of all caffeine, so retrieving the note must not expand its meaning. Substring matching is a useful bounded fallback but a linear scan is not a demonstrated large-history solution. No latency, relevance score, semantic-answer quality or production recall claim is made from four records.

## Proposed information model

The following is a design direction for later specs, not a new public schema.

| Dimension | Candidates | Example |
| --- | --- | --- |
| Ownership/audience | User-shared; one Bot; possibly a group or task after an explicit contract | Preferred timezone shared; an editor Bot's writing convention scoped to that Bot |
| Meaning | Current fact/preference; dated event with source references | Current city versus a trip last April |
| Context placement | Small pinned profile; bounded retrieved evidence | Language preference always available; last quarter's decision retrieved only when relevant |

Keep procedure instructions in the reviewed skill library, live task status in Runs/receipts, and current account balances or CRM state in their authoritative connector. A remembered report is historical evidence, not today's balance. Compaction is Pi's conversation-context mechanism and must remain distinct from durable fact storage.

A candidate record needs: stable ID; scope; kind; text; revision; status (`active`, `superseded`, `forgotten`); originating Bot and source references; recording time; evidence/event time when known; optional validity interval; and explicit replacement links. Host-generated provenance must bind the actual Run, conversation and message/tool result. A model may propose text and a referenced fact to change, but cannot invent a trusted source identity, widen scope or declare approval through record content.

Separate three times: when an event happened, when its source was created, and when OpenBot recorded it. Unknown times stay unknown. For example, a January email imported in October must not override the user's September statement that they moved cities. A role-specific writing preference can override a shared style default for that role; it cannot override a corrected user identity fact merely because it is Bot-local.

Do not treat model confidence numbers as evidence. Conflict resolution needs attributable sources and explicit user corrections. Ambiguous entity matching, contradictory same-authority facts or uncertain dates should remain visible as unresolved, and consequential tasks should consult the live source.

## Read and write behavior to design

**Reads.** The Host resolves the admissible scope before searching and checks it again when returning records. Search results carry stable record/source IDs, dates, status and truncation; unavailable sources are marked rather than fabricated. Expired, superseded and forgotten records are omitted from normal factual answers. A history question may access superseded evidence only through an explicit historical mode. Retrieved text remains untrusted guidance and cannot grant tool permission.

A shared user profile is a consciously shared subset, not a dump of every Bot's notes. Existing Bots share a Mac and are not security boundaries, but model-context filtering still reduces irrelevant exposure. Current Bot memory reaches groups and routines; changing that requires a clear migration and UI contract. Existing group-history restrictions must not be bypassed by copying history into a global memory record.

**Writes.** Preserve expected-revision checks, atomic history/receipt commits and stable invocation identity. Start with owner edits and explicitly attributable preferences in the existing foreground flow. Promotion to user-shared scope should be an explicit owner action or a separately configured policy. Do not add a memory summarizer that silently changes all Bots' behavior after every conversation.

For journal entries, derive confirmed event references from committed Run/tool/routine evidence. An assistant's claim of success must not create a confirmed event when a receipt is unknown. The model can summarize the evidence; receipt state controls the outcome. A future background extractor needs cancellation, durable deduplication, bounded costs and a freshness rule so it cannot overwrite later corrections after completing slowly.

**Corrections and forgetting.** Replacing a fact should mark the older record as superseded and update the compact profile atomically. Forgetting should suppress current profile inclusion, default retrieval and stale extraction jobs via a revision/epoch or tombstone. Restores must respect these markers unless the user explicitly chooses to restore the forgotten fact. This is suppression within the memory system, not full erasure of transcripts, Pi journal, backups or previously submitted provider context. Complete erasure needs a separate storage/backup/provider-scope contract.

**User experience.** Retain a readable current view, add “why remembered” with its source/date, show conflicts and sharing scope, and provide edit/forget/undo with honest limits. Empty-memory duplication stays the default. Any new surface needs English and Chinese text. Distinguish user-authored Bot instructions from learned facts; neither learned facts nor event records can change policy or grant access.

## Architecture and options

| Option | Benefits | Costs and limits | Recommendation |
| --- | --- | --- | --- |
| Increase the Markdown cap | Small implementation | More irrelevant context; no record provenance or conflict model | Do not use as the primary fix |
| Human-readable file/Git memory | Inspectable files and version history | Bypasses current Host/CAS/receipt ownership if ordinary file tools mutate it; difficult authority and migration semantics | Borrow readability; keep authoritative writes in Host tools |
| Structured local records + compact projection + literal/time search | Fits current durable store and local execution; explainable corrections | Needs migration, scope checks, derived index lifecycle and Chinese query coverage | Preferred staged experiment |
| Local embedding/hybrid retrieval | May handle paraphrases beyond literal search | Model assets, embedding versions, startup/index cost, deletion and relevance evaluation | Add only if measured lexical misses justify it |
| Hosted memory/embedding service | Outsourced indexing | New data egress, credentials, availability, deletion and cost dependencies | Outside the recommended local-first baseline |

Host application methods belong in `server-core`; authoritative Pi documents and prompt adaptation remain behind `agent-runtime`; tool calls use `tool-router`. A retrieval index should be disposable and rebuildable from committed records, never a second writer to Pi storage. No separate memory service, new placeholder package, automatic cross-Bot authority or Pi vendor synchronization is needed for this research.

A migration should preserve existing Markdown as a Bot-local legacy record/projection with its original revision/source metadata. Do not auto-extract and share legacy private facts. Choose a single source of truth and avoid indefinite dual writes. Backup/restore design (B14d) must cover facts, correction/forget markers and index rebuild before an irreversible format change; B14c's history index work is a possible shared foundation, not an excuse to replace its authorized corpus with all memory.

## Evaluation before implementation acceptance

Use a frozen synthetic English/Chinese corpus with source IDs, evidence times, user corrections and expected permissible scopes. Keep extraction, retrieval and answer generation scores separate. Start with current Markdown and literal conversation access as the baseline. Compare compact-only, compact plus lexical/time retrieval, and only then optional hybrid retrieval under the same model, corpus and context budget.

| Scenario | Required observable result |
| --- | --- |
| New topic, compaction, process restart | Correct current preference retained with stable provenance |
| Explicit user correction; old source ingested later | Current answer uses the correction, historical question can identify the earlier fact |
| Two simultaneous writers and replay after user edit | No lost correction, duplicate item or revived fact |
| Shared default and Bot role override | Role override affects style only; global facts remain consistently sourced |
| Group/task scope and malicious retrieved text | No unauthorized scope promotion, memory write or action |
| Failed/unknown CRM operation | No confirmed-success event without receipt evidence |
| Forget, interrupted extraction, restart and restore | Forgotten fact stays out of ordinary context/retrieval; declared restore semantics hold |
| Chinese two-character names and English paraphrases | Report retrieval misses; distinguish retrieved related evidence from an entailed answer |
| Missing fact, unavailable source, unresolved contradiction | Honest abstention or a concrete clarification, not a guessed fact |
| 100 / 1,000 / 10,000 synthetic records | Record disk size, rebuild time, p50/p95 retrieval latency, context bytes/tokens and update cost |

Proposed starting retrieval experiment: at most five records and a fixed model-context budget, with an explicit truncation marker. This is an experimental setting, not a settled product limit. Measure precision/recall against evidence IDs, current-fact accuracy, false recall, unauthorized disclosures/writes, correction survival and total model/tool cost. Deterministic state/scope/replay checks must pass completely; answer-quality thresholds should be chosen against a measured baseline before a release decision. Any model judge should retain evidence for human audit and be identified separately from exact assertions.

LongMemEval can supplement temporal/update/abstention coverage, with pinned dataset/version and its evaluation limitations stated. Do not substitute a benchmark score for OpenBot-specific approval, deletion, group scope, restart or bilingual UI checks. This research did not run LongMemEval or train/test embeddings.

## Suggested delivery sequence and unresolved decisions

1. **Record integrity and correction:** a ready spec for per-fact provenance, explicit replacement/forget semantics, legacy migration and current UI compatibility. Resolve backup and deletion contracts first.
2. **Shared user facts:** define explicit promotion, source precedence, group/routine context scope and owner controls. Do not infer sharing from Bot-to-Bot messages.
3. **Bounded retrieval:** introduce a Host-authorized lookup over committed records, lexical/date baseline and measured Chinese handling; reuse history sources where already authorized.
4. **Optional extraction/hybrid search:** only after baseline evidence, with cancellation/cost/index-version controls.

Open decisions for the implementation specs: which facts can be auto-saved vs reviewed; how much is shared by default; whether groups need their own records; the correction precedence model for ambiguous identities; byte/token/retention budgets; source-deletion and backup restoration semantics; and whether lexical evaluation warrants an embedding dependency. The recommendations above make these decisions concrete without silently fixing new product contracts.

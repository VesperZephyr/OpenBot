# B27c: Bounded Retrieval Evaluation — 2026-11-01

## Decision and scope

Proceed with [B27c's opt-in placement contract](../tasks/b27c-bounded-memory-retrieval.md), keeping existing notes always loaded by default. The demonstrated benefit is omitting rarely relevant content from fresh requests. This is not evidence for a default cost optimization: the measured mixed workload used more input/output tokens and took longer with retrieval. Keep frequently needed facts and important preferences always loaded. Do not increase storage, add embeddings or build an index on this evidence.

The reviewed product baseline is `d6bab2c`. Only documentation and standalone synthetic research scripts changed. No application was launched, no owner memory/history was read, and no product code, dependencies, persistence or credentials were changed. The existing configured provider credential was resolved in process for the expressly requested quality experiment; neither credentials nor endpoint details are part of the fixtures or this record.

## Method

The [deterministic fixture](fixtures/b27c-retrieval.mjs) defines 28 synthetic records, including active notes, one forgotten shared topic and one moved-out marker. Active stored Markdown is 5,745 bytes local and 1,343 bytes shared, within B27a's existing limits. Shared-topic suppression leaves 6,978 eligible bytes. Two always-loaded notes occupy 166 bytes; the remaining eligible active notes are on demand. Repeated workshop logistics create irrelevant context, and a deliberately repetitive archive note places its answer beyond the first 2 KiB read chunk. These are controlled stressors, not a sample of owner memory.

The [provider runner](fixtures/b27c-model-probe.mjs) compares all-loaded and selective arms on identical notes/questions. It invokes the already configured `mafia / claude-opus-5-5` model via `anthropic-messages`, with fresh message arrays, alternating arm order, no cache directives or transport retries, 768 maximum output tokens/request and a 60-second request timeout. Sampling temperature is omitted: two setup requests were rejected before evaluation because this configured model rejects `temperature`. No pricing was returned/configured, so dollar cost is unknown.

A model decides whether and how to search. The harness executes only its in-memory `memory_search`/`memory_read` simulations; no shell, file, network or application tools are offered to the model. Searches include scope precedence; this is not a substitute for testing Host/Run authorization. Arguments/results and synthetic answers stay in temporary local evidence. This document preserves reviewed measurements and findings, not raw execution logs.

The final policy uses existing protected-topic metadata, keyword shortening and language reformulation, and allows three retrieval rounds before a final response. The main corpus treats its local notes as owner-protected. Shared titles are already listed by the product; protected local titles can also help the model choose queries. This is not proof of equivalent retrieval when those hints are absent. A separate unprotected-local check addresses two such cases below.

The runner is intentionally smaller than the application: it omits the rest of the Bot prompt, write tool, other tool families, Pi history/compaction, UI, policy/approval and persistence. Its model-facing reference schema is abbreviated and results omit the proposed `headingTruncated` field. Product schema/framing overhead must therefore be measured again at implementation acceptance. Reported provider tokens count the entire actual experimental request, including schemas, guidance, metadata, all prior tool calls and results; they are not estimates from Markdown bytes.

## Deterministic bilingual retrieval

Each query has an independently specified relevant note ID. `recall` here means finding that ID in the first five hits; it does not mean answering a task correctly.

| Query family | Relevant IDs found / expected | Interpretation |
| --- | --- | --- |
| English literal, including case/NFKC/whitespace | 10 / 10 | Exact phrases work; no unrelated hits |
| Chinese literal, including two-character terms | 8 / 8 | `香港`, `酒店`, `居住` work without a tokenizer |
| English paraphrase | 0 / 4 | `brief responses` does not find `concise answers` |
| Chinese paraphrase | 0 / 4 | `住宿报销标准` does not find the hotel budget |
| Cross-language | 0 / 4 | Query translation is not a matcher feature |
| Accent, dash and Traditional-script differences | 0 / 3 | `Cafe`, `A–17`, `預算` are not silently folded |
| Absent or suppressed content | 5 / 5 correct empty results | Includes forgotten/shared precedence and moved-out notes |

Across the 33 positive relevance labels, the first literal query finds only 18. Precision on returned positive-query hits is 18/18, but this small constructed set does not establish general precision. Reporting only the perfect literal subset would hide the practical recall limitation.

Additional assertions cover group exclusion (the shadowed local address is eligible in a group), the first-five ordering/truncation, empty/overlong queries, stale refs, offset boundaries, reordered reference fields, JSON escaping, emoji and lossless chunk reconstruction. These test the research mechanics, not product authorization or restart guarantees. A 256-record in-memory scan repeated 1,000 times on Node 22.22.2 measured approximately 0.11 ms median / 0.18 ms p95. It excludes store I/O, authority checks and rendering; it supports avoiding an index, not a product latency SLA.

## Provider findings, including failures

1. **Initial policy, 12 pairs / 38 successful requests:** the all-loaded arm answered all 12 correctly. Selective loading answered ten correctly after manual review. The Chinese collections question missed the English note: the model tried `催收`, `逾期`, `overdue invoice`, `未付款`, `账单` and `collections`, none of which is a literal substring of the relevant note. The long-note case exhausted the two retrieval rounds before its final chunk and returned no answer. This initial prompt also omitted existing protection metadata, so it is not a faithful product-context comparison.
2. **Revised policy, 14 pairs / 44 requests:** retain the protection metadata, explicitly shorten failed phrases to individual words/stems, and allow three retrieval rounds. Add English review-date and Chinese shipping-destination prompts after the initial run. All-loaded passed 14/14; selective passed 13/14 after manual review. The long-note failure was in the experimental reader: it compared JSON strings and rejected the same reference when the model reordered object keys. No other row returned a reader error.
3. **Reader repair, affected pair / five requests:** compare reference structures rather than JSON property order and add an offline regression. Both arms returned `IRIS-93`; the selective arm searched and read two chunks. The consolidated result is 14/14 per arm, assembled from the revised batch plus this affected-case rerun. It is **not** a fresh full-batch repeat or a statistical accuracy estimate. The initial failures and revised pre-repair failure remain part of the evidence.
4. **Local-title sensitivity, two pairs / seven requests:** omit local protected-topic names while retaining shared names, simulating the discovery disadvantage of unprotected local notes. Both arms answered the Chinese residence and collections questions correctly. Residence needed six searches across two rounds (`住址`, `address`, `moved`, `live`, `home`, `居住`), using 5,027 input tokens versus 2,562 all-loaded. Collections found the English note through `overdue` after Chinese queries, using 2,770 versus 2,572 input tokens. This is a prompt-visibility probe, not a product learning/provenance test; it shows that reformulation can work without local titles, with higher and variable overhead. These rows are not included in the main table.

In total, 94 successful inference requests were made across the initial batch, revised batch, affected-case rerun and title-visibility probe, plus the two rejected setup requests. No further model runs were used to select a favorable aggregate result.

Both absent-number cases correctly abstained. The simple English answer marker missed “I couldn't find your passport number”; manual inspection corrected that scoring error without changing the fact oracle. Inspect every answer, including its constraints, rather than trusting a keyword alone. Current address retrieval used Warehouse Maple rather than the old Cedar claim in the question, and the collections answer retained “strictly greater than 20” and the paid-invoice exclusion. This tests static current-state use, not an actual concurrent correction or restart.

The revised model often searched exact protected-topic titles. The improvement cannot be attributed solely to the keyword instruction: metadata and round allowance changed together. Unprotected local notes, different models and real phrasing distributions may behave differently. There is no automatic translation, semantic equivalence or reliable no-match conclusion in the matcher.

## Measured benefit and overhead

Each cell below is **all-loaded / selective**. Input and output tokens are provider-reported sums across every request needed for that task. The `long-zh` row uses the repaired affected-case pair; all other rows use the revised batch. Seconds are rounded wall-clock observations, not a latency distribution.

| Task | Input tokens | Output tokens | Provider requests | Seconds |
| --- | --- | --- | --- | --- |
| irrelevant-en | 2726 / 1254 | 12 / 12 | 1 / 1 | 2.1 / 1.9 |
| irrelevant-zh | 2731 / 1259 | 68 / 62 | 1 / 1 | 2.1 / 5.2 |
| literal-en | 2733 / 2766 | 53 / 103 | 1 / 2 | 1.8 / 4.9 |
| literal-zh | 2741 / 2785 | 40 / 104 | 1 / 2 | 2.2 / 4.1 |
| paraphrase-en | 2749 / 2815 | 83 / 140 | 1 / 2 | 2.5 / 4.7 |
| paraphrase-zh | 2726 / 2743 | 10 / 75 | 1 / 2 | 1.8 / 4.7 |
| cross-en | 2732 / 2916 | 87 / 138 | 1 / 2 | 6.8 / 4.8 |
| cross-zh | 2736 / 2974 | 121 / 205 | 1 / 2 | 4.0 / 9.3 |
| current-en | 2745 / 4583 | 94 / 227 | 1 / 3 | 2.2 / 6.9 |
| long-zh | 2742 / 7896 | 83 / 371 | 1 / 4 | 2.5 / 14.7 |
| absent-en | 2724 / 2755 | 53 / 148 | 1 / 2 | 8.6 / 4.8 |
| absent-zh | 2726 / 2759 | 70 / 173 | 1 / 2 | 6.5 / 4.7 |
| holdout-review-en | 2730 / 2760 | 36 / 101 | 1 / 2 | 2.2 / 5.6 |
| holdout-delivery-zh | 2738 / 4936 | 26 / 292 | 1 / 3 | 2.0 / 18.3 |

- **Unrelated tasks:** input fell from 5,457 to 2,513 tokens (54.0%); neither selective trial searched or added a request. Each saved 1,472 input tokens. This is the useful marginal case, with nearly all optional content irrelevant.
- **Ten recall tasks:** input increased from 27,372 to 37,174 tokens (35.8%); output increased from 633 to 1,756. Retrieval used 24 provider requests versus ten, including the long note's four-request path.
- **Whole mixed set:** input increased from 38,279 to 45,201 (18.1%); output increased from 836 to 2,151 (157.3%). Provider requests increased from 14 to 30, with 21 memory-tool calls. Summed task time was about 47.4 versus 94.5 seconds. The experiment does not justify a speed claim.

Using only these observed averages, unrelated tasks must exceed roughly 36% of requests for **input-token** break-even against the other twelve cases. This arithmetic is workload-specific, ignores output prices and does not establish monetary break-even. Output/tool generation, real tool schemas, context reuse and caching can shift it substantially. All reported cache-read/cache-write counters were zero. A long-running Pi conversation may already retain old note copies; placement cannot reclaim that context. Warm-cache and real-session economics remain unmeasured.

## Contract consequences

- Placement is owner-selected, always-loaded by default, and orthogonal to scope and fact protection. Do not promote a privacy/erasure claim or larger capacity.
- Keep literal search and deterministic bounds. Explicitly guide query shortening, other-language retries and chunk completion. A search miss must not become a claim that the fact never existed.
- Preserve the existing protection metadata and acknowledge that it exposes titles. Do not add an unbounded extra title catalog to mask weak recall.
- Compare references structurally. Recheck authority/revisions for every chunk; a valid reference with reordered keys is still valid, while corrected/forgotten state must not be returned under an old reference.
- Product acceptance must use actual request-boundary measurements and a full paired run, not this script as evidence of implemented policy or recovery. The spec owns the quality/value gates and test matrix; this report owns the dated measurements.

## Reproduction and limits

Offline, no dependencies, credentials or model calls:

```sh
node docs/research/fixtures/b27c-retrieval.mjs
```

The live runner prints usage and exits unless `--live` is explicit. It needs the existing `jsonc-parser` dependency from an installed checkout, a caller-selected configured provider/model and an output path outside the repository. The configured API key may use the repository's existing literal, environment or `!command` convention. The runner does not install dependencies, select a different provider, refresh credentials or print command errors/credential values.

```sh
node docs/research/fixtures/b27c-model-probe.mjs --live \
  --config /absolute/path/to/models.json --deps-root /absolute/path/to/installed-checkout \
  --provider mafia --model claude-opus-5-5 --output /tmp/b27c-evidence.json
```

`--variant initial` recreates the earlier prompt/round policy with the repaired reader. `--cases long-zh` limits a run to the long-note pair; `--cases cross-zh,paraphrase-zh --unprotected-local` reproduces the local-title sensitivity probe. The default revised run has at most 70 requests; the initial variant has at most 48. Each task arm is bounded separately; unknown/failed tool outcomes are supplied as evidence, never repaired by an automatic network retry. Automated answer markers are preliminary and require manual review. No current fixture reproduces a deliberately broken JSON-order reader; its regression now rejects that bug.

Single-model, single-run synthetic results cannot establish production accuracy, semantic recall, OS/native behavior, billing savings or stable latency. Runtime/policy/replay, backup compatibility, actual UI and warm-cache behavior remain implementation acceptance work. Those limitations are reasons to keep the opt-in scope and explicit gates, not to enlarge this design into a vector store or a benchmark platform.

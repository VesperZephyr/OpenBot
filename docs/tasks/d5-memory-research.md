# D5: Local Memory Research

Status: done (merged in #44); research complete, no product changes
Branch: task/d5-memory-research; pull request target: main
Depends on: merged B6, B19, B24/B25 and I3; independent of B6a implementation
Architecture: Sections 4.1, 5.1, 5.7, 5.8 and 7.1

## Goal

Study how OpenBot should retain user facts, role context and dated evidence without losing corrections, expanding authority or filling every model request with irrelevant history. Deliver a sourced recommendation, a reproducible retrieval probe and the decisions needed for implementation specs.

## Scope

In: inspect actual memory/history/prompt code; compare the Grok self-report with primary memory design documentation and research; examine sharing, provenance, conflicts, forgetting, retrieval, migration and evaluation; run a tiny isolated bilingual SQLite probe.

Out: product code, new model-facing tools, changed memory schema/permissions, migration, shared writes, embeddings, background extraction, new dependencies, provider uploads, benchmarks on personal data, OAuth/model review and Phase 3.

## Research contract

Separate observed source/code facts, measured probe results and proposed designs. Label Grok's prompt as an unverified self-report. Distinguish current Letta MemFS documentation from its legacy block/archive API. Treat the retrieval probe as a mechanism experiment, not a memory-quality benchmark.

Preserve the local target, Host ownership, Pi adapter boundary, target-bound tool authorization, revisions and replay safety. Any product implementation needs a separate ready spec. An unresolved design decision is an explicit output of research, not permission to choose silently during implementation.

## Steps

1. Inspect B6/B19 code, current channel contexts, scoped application history and existing tests.
2. Read primary sources for shared/personal memory, profile/collection trade-offs and memory evaluation.
3. Compare SQLite lexical matching on synthetic English/Chinese records with development and existing packaged Node runtimes.
4. Write `docs/research/memory-design.md`, including alternatives, recommended stages, deletion/migration limits and evaluation cases.
5. Index the research in backlog, task index and technical plan; create a documentation PR.

## Acceptance

1. Every current-state claim has a repository source; every external claim has a primary source and retrieval date.
2. Research separates scope, information type and context placement; recommends provenance/conflict/forget semantics without changing product contracts.
3. The standalone probe is repeatable, reads no owner data and reports exact runtime versions and matching results; its limits are explicit.
4. Evaluation covers correction, stale extraction, replay, scope, unknown effects, forgetting/restore, English/Chinese queries, abstention and cost.
5. Proposed implementation stages name remaining decisions and backup/index dependencies; exclusions remain intact.
6. Documentation links and diff formatting are checked. No full product suite is required for documentation and an isolated research probe; B6a verifies its own product change separately.

## Risks

Vendor docs change and self-reported prompts can be inaccurate. Memory relevance and answer accuracy cannot be inferred from retrieval alone. A toy corpus is not a performance benchmark. Clear/current suppression must not be mislabeled full erasure across transcripts, journals, backups and providers.

## Open questions

Implementation choices are recorded in the research report, especially sharing defaults, source precedence, retention, backup/forget semantics and whether lexical misses justify embeddings. This task does not authorize resolving them in product code.

## Evidence

- [Research report](../research/memory-design.md) distinguishes current B6/B19 behavior, primary external sources and recommended future contracts. Sources were retrieved on 2026-10-21.
- [Standalone probe](../research/fixtures/memory-retrieval-probe.mjs): four synthetic records, seven queries; identical results under Node 22.22.2 / SQLite 3.51.2 and the existing packaged Node 24.22.0 / SQLite 3.53.4. Two-character Chinese queries miss under unicode61 and trigram MATCH; literal substring finds them. English vocabulary differences remain unresolved by all three literal strategies.
- No personal data, model APIs or embeddings were used by the probe. LongMemEval was reviewed, not run. No package dependency, runtime policy, schema, Pi vendor or UI change.
- Local Markdown targets and `git diff --check` validated. Product test results belong to the separate B6a PR.

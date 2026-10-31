# Bot Project Comparison and Adoption Priorities

Research date: **2026-10-30**. Status: dated source review and design recommendations, not an implementation spec or product benchmark. Local baseline: `884892e6d3ff182a551ccb51d1f5c868c0027add`, plus the B28a/B28b working drafts reviewed on this date; those drafts are not merged implementation. The [backlog](../backlog.md) owns scheduling, existing specs own contracts, and [architecture](../architecture.md) owns runtime and trust boundaries.

## Recommendation

Keep the Pi adapter, Host Runtime and local Executor architecture. Borrow improvements to memory selection, behavior regression evidence and policy preview. Do not replace the runtime to acquire a competitor's feature list. Complete existing delivery work and preserve signed-update/native-release priorities before admitting new feature implementation.

The main incremental opportunity is to make existing capabilities more useful over time: retrieve the right remembered evidence, preserve failures as reproducible scenarios, and show what a permission rule would change. Messaging, collaboration, reviewed skills and browser takeover already have owners below; this research does not create parallel tasks for them.

## Evidence and comparison boundaries

The review inspected repository documentation and selected implementation/test sources at these revisions. No competitor application, evaluation suite or packaged release was run. Feature breadth is not evidence of task success, performance, security certification or release stability.

| Project and pinned revision | Relevant architectural difference | Adoption implication |
| --- | --- | --- |
| [OpenMausBot, `18d5495`](https://github.com/milind-soni/OpenMausBot/tree/18d549510c3d4733306e71b1d4ac207258d98577) | A chat-oriented Bot team with multiple Agent drivers and local, VM and cloud execution choices | Study memory and evaluation mechanisms; its engine-specific permission mappings and deployment scope do not transfer directly |
| [nightly-labs/openbot, `0745371`](https://github.com/nightly-labs/openbot/tree/074537193c5808f035eed71d9858a1b165ee4080) | A persistent Agent workspace using Codex App Server, Claude and ACP integrations, with desktop/browser/mobile and server surfaces | Study task visibility and bounded context; separate workspaces do not establish process isolation |
| [CopilotKit/OpenBot, `ab9855c`](https://github.com/CopilotKit/OpenBot/tree/ab9855c19848378c90a806426130d86699cc798c) | A customizable AG-UI application template with PostgreSQL, CopilotKit Intelligence and governed computer environments | Study gateway decisions and policy replay; adopting its platform would introduce different operational and licensing dependencies |

OpenBot controls model-selected tool dispatch through its runtime adapter and authorization path. Its [receipt ledger](../../packages/local-executor/src/ledger.ts) and [recovery tests](../../e2e/recovery.e2e.ts) are useful foundations to retain, not proof of superiority over these projects. Existing [release and runtime gaps](../technical-plan.md) remain open according to their owning records.

Source pointers below are pinned to the reviewed revisions. They support observations; proposed OpenBot adaptations are explicitly recommendations.

## Overlap with existing work

| Observed idea | Existing OpenBot owner | Disposition |
| --- | --- | --- |
| Separate deliberate messages, activity and actionable outcomes | [B28a](../tasks/b28a-messages-fixed-activity.md); optional wording in [B28b](../tasks/b28b-generated-activity.md) | Continue those designs. No new status generator, transcript store or messaging task. B28a must stand alone; B28b keeps its own default-off quality/cost evaluation |
| Explain remembered facts, corrections, forgetting and sharing | [B27a](../tasks/b27a-memory-provenance.md), [memory research](memory-design.md) | Do not rebuild provenance or the editor. New evidence concerns bounded selection and retrieval |
| Explicit task owners, delegation, handoff, cancellation and recovery | [B2](../tasks/b2-runs.md), [B13c](../tasks/b13c-collaboration.md), [B14b](../tasks/b14b-lifecycle-gates.md) | Reuse current contracts. User-controlled reassignment or broader routing would require demonstrated need and separate design |
| Scripted integration checks and real-model spot checks | [ScriptedModel](../../e2e/scripted-model.ts), [I3](../tasks/i3-workflow-acceptance.md), [I4](../tasks/i4-role-memory-acceptance.md) | Extend existing infrastructure. The additional proposal is reusable sanitized behavior traces, not a second test harness or another claim that live acceptance is complete |
| Reviewed methods, exact revisions, role defaults and routines | [B10](../tasks/b10-reviewed-skills.md), [B27b](../tasks/b27b-role-skills.md), [role research](bot-role-design.md) | The work-to-reviewed-method loop already exists. Only automated candidate extraction is a distinct later possibility |
| Approval rules and execution records | [B12a](../tasks/b12a-deterministic-policy.md), [B13d](../tasks/b13d-usage-evidence.md) | Existing approval reasons are not missing infrastructure. Consider richer decision evidence and preview, without replacing policy precedence or the receipt ledger |
| Browser snapshot freshness, takeover and secrets | [Phase 3](../development-roadmap.md#7-p3-browser-desktop-and-demonstration-deferred) | Retain feasibility and packaged-evidence gates. Add external examples to those future designs, not browser capabilities to current acceptance |
| Capability readiness and model setup | [role research](bot-role-design.md), [B16](../tasks/b16-model-sources.md), [known gaps](../technical-plan.md#12-known-gaps-in-existing-code) | Provider discovery and readiness already have a planning home; this comparison supplies no evidence that multi-engine support should precede them |

## Incremental findings

### Bounded memory selection and retrieval

OpenMausBot separates a bounded always-loaded note from topic files and logs, exposes the loading budget, and documents expiration and supersession. Its extraction code asks for supporting words and checks user-fact evidence against statements rather than accepting questions or hypotheticals as facts. These checks are heuristics, not a guarantee of semantic truth. See [memory behavior](https://github.com/milind-soni/OpenMausBot/blob/18d549510c3d4733306e71b1d4ac207258d98577/docs/memory.md) and [capture implementation](https://github.com/milind-soni/OpenMausBot/blob/18d549510c3d4733306e71b1d4ac207258d98577/server/memory-capture.ts).

nightly implements an essential/searchable distinction, preserves user-controlled selection, and maintains a SQLite FTS5 index. This is concrete evidence that bounded context need not begin with a separate vector service. See [selection and index code](https://github.com/nightly-labs/openbot/blob/074537193c5808f035eed71d9858a1b165ee4080/src/backend/agent-memory-selection.ts).

**Recommended delta:** design selection and retrieval over existing committed notes and already-authorized evidence, with visible inclusion/source explanations. Keep Host-owned revisions and recovery; do not make arbitrary Markdown file writes a second authority path. Any index should be rebuildable from canonical records and covered by backup/restore semantics.

Use the existing [memory evaluation and retrieval probe](memory-design.md#a-small-reproducible-retrieval-probe). It already found short-Chinese-query misses with FTS tokenizers; copying nightly's `unicode61` choice is not an adequate bilingual design. Measure retrieval separately from answer correctness, and carry forward correction, forgotten-note suppression, scope and restoration cases. Budgets, source retention and semantic contradiction rules remain decisions for a ready spec, not settled by this report. Background capture and embedding dependencies stay outside the first retrieval increment.

### Reusable behavior regression evidence

OpenMausBot separates deterministic scripted scenarios, sanitized golden-thread replay and opt-in live-model evaluation. Stable traces compare tool sequences, dispatch destinations and handoff outcomes rather than incidental prose. See its [evaluation structure](https://github.com/milind-soni/OpenMausBot/blob/18d549510c3d4733306e71b1d4ac207258d98577/evals/README.md).

**Recommended delta:** reuse ScriptedModel, existing Host/e2e fixtures and the opt-in [role-memory runner](../../scripts/acceptance/role-memory.mts). Promote a real failure into a synthetic scenario with an independent expected outcome; retain only sanitized, stable trace fields. Do not persist owner transcripts, command environments or raw model outputs as golden fixtures. A redaction pipeline needs its own leakage checks before automatic ingestion is permitted.

Start with failure categories already relevant to OpenBot: a completed-looking reply without the expected artifact, a method revision substituted despite a pinned selection, duplicate result publication after restart, and stale correction or authority after handoff. First search existing tests and extend the responsible regression rather than creating duplicate cases. Structured outcomes and artifact bytes should decide correctness; a model judge can supplement wording assessment but cannot establish authorization or exactly-once side effects.

This work does not gate B28a on building an evaluation framework. Feature regressions continue in their owning specs; a reusable trace layer should be scoped only when several real cases justify it. Live runs remain separately enabled and budgeted, with exact model/version and unperformed retests recorded as in I4.

### Policy explanation and historical preview

CopilotKit replays a candidate policy against recorded action facts using its live policy evaluator, reports changed decisions and skips records that cannot reconstruct the necessary context. See [policy dry-run](https://github.com/CopilotKit/OpenBot/blob/ab9855c19848378c90a806426130d86699cc798c/server/src/computer/policy-dry-run.ts) and its [tests](https://github.com/CopilotKit/OpenBot/blob/ab9855c19848378c90a806426130d86699cc798c/server/tests/policy-dry-run.test.ts).

**Recommended delta:** first assess whether current approval and usage views can explain the deciding rule and scope; then design a read-only preview of a proposed rule. Existing [policy decisions](../../packages/server-core/src/approvals.ts) already supply ask/deny reasons. The new value is consistent evidence of why a rule applied and what editing it would change, not another decision engine.

Do not assume executor receipts contain everything needed to reconstruct a past policy context. A spec must identify trusted decision-time facts, policy/grant versions, redaction and retention, and whether canonical paths can be replayed without consulting a changed filesystem. Reuse the actual evaluator with a captured context; incomplete records must report insufficient evidence. Preview performs no tool execution, grants no authority and never turns an uncertain historical side effect into a successful one. Any new persisted evidence needs versioning and backup coverage.

### Later evidence for existing design areas

**Browser control:** CopilotKit resolves an element reference against a server-held snapshot before policy evaluation; model-supplied button labels do not decide authority. Its [gateway](https://github.com/CopilotKit/OpenBot/blob/ab9855c19848378c90a806426130d86699cc798c/server/src/computer/gateway.ts) is a useful implementation reference for the already-planned freshness boundary. OpenMausBot's [lazy computer-claim scenarios](https://github.com/milind-soni/OpenMausBot/blob/18d549510c3d4733306e71b1d4ac207258d98577/evals/README.md) suggest testing that screen-independent work does not unnecessarily reserve scarce control. Evaluate resource acquisition in the relevant Phase 3 spike; a VM screen claim is not equivalent to a lease over a physical Mac.

**Skill improvement:** CopilotKit's [Automatic Learning](https://github.com/CopilotKit/OpenBot/blob/ab9855c19848378c90a806426130d86699cc798c/docs/automatic-learning.md) separates collected evidence, candidate review, publication and revision delivery. OpenBot already has reviewed saving and exact pins. Revisit automated candidate extraction only if repeated manual extraction becomes a measured burden, preserving source consent, secret exclusion, explicit publication and validation on a different input. It must not silently update existing routines or authorize tools, and it does not require adopting Intelligence.

**Task visibility:** nightly's [channel design](https://github.com/nightly-labs/openbot/blob/074537193c5808f035eed71d9858a1b165ee4080/docs/architecture/channels-and-messaging.md) connects task ownership, bounded context and revised requests. Use it to review whether existing OpenBot controls communicate who owns work, what is waiting and what remains uncertain. Do not import its routing or channel-management authority into B13c as a UI refinement.

## Priority rationale and admission conditions

This is the ordering rationale on the research date; the [backlog](../backlog.md#research-informed-design-order) is the maintained design queue. Existing delivery and release obligations retain precedence. These candidates have no claimed branch, implementation status or settled protocol.

| Recommendation | Why this order | Before implementation |
| --- | --- | --- |
| Continue B28a and assess B28b separately within their current plans | They already own message clarity and activity truth; a competing workstream would duplicate design | Follow their own readiness and acceptance. Optional model wording is not a prerequisite for useful fixed status |
| First new feature design: bounded memory retrieval | Builds on existing provenance and directly addresses long-lived Bot usefulness; prior bilingual research already narrows the experiment | Resolve bounded context, allowed sources, correction/forgetting and restore behavior; measure lexical retrieval against the existing corpus before selecting an index |
| Next engineering design: reusable behavior traces | Preserves evidence across prompt/runtime changes without replacing current tests | Identify repeated cases not already adequately covered; define sanitized stable traces, independent oracles and opt-in live cost limits |
| Then: policy explanation/preview | Makes permissions easier to understand, but historical replay may require additional sensitive persisted facts | Audit current evidence first; settle privacy, replay fidelity and migration before promising historical preview |
| Keep automated skill extraction and browser/desktop work deferred | Reviewed skill use already works; automated extraction adds write/consent risks, and control has native feasibility dependencies | Demonstrate manual-authoring friction for extraction; retain the existing Phase 3 feasibility gates for control |

Reorder only with evidence: retrieval-quality measurements, repeated regression-maintenance cost, or observed permission confusion. A concrete authorization defect belongs in its owning correctness task immediately; it must not wait for the later preview feature. Native evidence can proceed independently where resources permit, but no research candidate clears a release gate.

## Approaches not adopted

- **Replacing Pi with multiple CLI engines:** potentially useful if an actual subscription/provider requirement emerges, but different permission, cancellation and recovery semantics need a dedicated design. Feature breadth alone is insufficient.
- **Copying permissive defaults:** OpenMausBot documents Full access as its normal new-Bot default, with a hosted-workspace exception; nightly explicitly warns of full-access operation without per-action confirmation. CopilotKit's evaluator can fail closed while its shipped startup action policy explicitly allows all unless replaced. These are distinct layers and should not be described as uniformly strict authorization. Sources: [OpenMausBot approval modes](https://github.com/milind-soni/OpenMausBot/blob/18d549510c3d4733306e71b1d4ac207258d98577/docs/approval-levels.md), [nightly README](https://github.com/nightly-labs/openbot/blob/074537193c5808f035eed71d9858a1b165ee4080/README.md), [CopilotKit policy and deployment boundaries](https://github.com/CopilotKit/OpenBot/blob/ab9855c19848378c90a806426130d86699cc798c/docs/architecture.md).
- **Importing deployment assumptions:** cloud computers, accounts, multi-user authorization and mobile access are outside this product's current scope. CopilotKit's container/profile arrangement is configurable; neither its marketing description nor a separate folder establishes one independently isolated computer per Bot in every deployment.
- **Equating source availability with permission to copy:** the reviewed roots use [Apache-2.0](https://github.com/milind-soni/OpenMausBot/blob/18d549510c3d4733306e71b1d4ac207258d98577/LICENSE), [PolyForm Noncommercial](https://github.com/nightly-labs/openbot/blob/074537193c5808f035eed71d9858a1b165ee4080/LICENSE) and [MIT](https://github.com/CopilotKit/OpenBot/blob/ab9855c19848378c90a806426130d86699cc798c/LICENSE), respectively. This review imports no code or assets. Any future reuse must check the relevant file/dependency terms; a root license does not establish terms for a separate service.

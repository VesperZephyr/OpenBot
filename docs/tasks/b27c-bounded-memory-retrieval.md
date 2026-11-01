# B27c: Bounded Memory Selection and Retrieval

Status: in progress
Branch: `task/b27c-bounded-memory-retrieval`
Depends on: B27a, B14d; preserve B13a/B13c context scope and B28a activity presentation
Architecture: Sections 1.1, 5.1, 5.7, 6.1 and 8.3

## Goal

Let the owner choose which existing memory notes stay in ordinary model context and which are read when needed, while keeping useful facts attributable and corrections authoritative. Establish whether selective loading improves task quality or total context cost before changing defaults. This is not long-history recall or a larger memory store.

## Scope

In: an owner-controlled placement choice on existing notes; bounded model reads over the same authorized current notes; source references; placement-aware prompt and Memory UI; migration, correction, forgetting, replay and backup behavior; bilingual evaluation.

Out: more stored content, a new archive, conversation/file/connector search, historical fact reconstruction, automatic extraction or placement, semantic contradiction resolution, embeddings, a vector service, cross-Bot memory access, group-owned memory, automatic sharing, procedure learning and full data erasure. Existing history tools, B27a provenance and B10 skills keep their own contracts.

## Design

### Why a search tool alone is insufficient

At the reviewed baseline, [prompt projection](../../packages/agent-runtime/src/prompt.ts) already supplies the allowed local/shared memory in full. [B27a](b27a-memory-provenance.md) bounds active content to 8 KiB per Bot and 4 KiB shared, with at most 128 retained identities per document. Searching the same fully supplied text adds a tool round without establishing a benefit.

The proposed increment therefore separates **placement** from **audience** and **content protection**. Owner-selected on-demand notes would be omitted from ordinary memory content but remain available through governed reads. Default placement remains always-loaded for legacy notes and new notes, so an upgrade or model write cannot silently remove a preference from context. The owner may keep everything always-loaded.

This deliberately tests a smaller claim than the broader [memory research](../research/memory-design.md): lower irrelevant context while retaining the same stored knowledge. It does not solve the current storage cap, search all past conversations, or promise that a model will recall an omitted fact. If measurements show no useful trade-off, keep the present projection instead of adding machinery merely because other products have it.

### Canonical records before an index

Keep writes and snapshots in the existing Host-owned memory documents. The corpus is already small and bounded: recommend a cancellable scan over the authorized active notes, without a new SQLite index, worker, package or background synchronization job. Reconsider indexing only with a separately justified corpus expansion and measurements.

The [bilingual and provider experiment](../research/b27c-retrieval-evaluation-2026-11-01.md) establishes the narrow benefit and failure cases. Use literal phrase matching that handles short Chinese strings. Model-guided keyword reformulation can recover some paraphrases; the matcher itself does not translate, stem words or infer synonyms. Do not silently introduce an embedding fallback. The bounds below are implementation limits, not latency or quality guarantees.

## Contracts

These contracts cover the opt-in increment. Default-always behavior remains the fallback; implementation and its product acceptance are separate from the design experiment.

### 1. Placement, persistence and compatibility

- Add optional `MemoryNote.placement: "always" | "on-demand"`. Missing means `always`; there is no model-selected placement parameter. Do not raise content or identity quotas. Markdown remains the complete active-content projection, not just the always-loaded subset.
- An owner placement mutation uses the existing stable request identity and document revision discipline. A duplicate committed request does not create another revision; changed arguments conflict. Changing placement does not alter factual provenance or turn an otherwise editable note into an owner-protected fact. Placement survives later edits to the same note identity.
- Extend `bots.memory.note` / `MemoryNoteChange` with `{ action: "placement", noteId, placement }` and the existing `botId`, `requestId`, `scope`, `expectedRevision` fields. Only active notes may change placement. Validate revision before a new request; a same-effective-placement request commits its receipt without advancing the document revision. An actual change advances the document revision/history and document user-update timestamp, preserving the note's `original`, `changed` and `protected` values. Receipt replay uses B27a's current-state response semantics, not a second copy of historical content. Do not expose this action in model management or Code Mode.
- Shared placement is a shared-owner decision affecting all eligible Bots, not a private override on one Bot. Explain its audience before saving. Scope moves preserve placement with the note and retain the existing two-document atomicity and destination conflict behavior.
- Clear/forget retains the existing topic protection. No background task or model read changes placement, revives a forgotten note or adds an alias. Existing same-key suppression must apply before placement filtering and retrieval; an on-demand or forgotten shared topic must not reveal a shadowed local version.
- Keep current and historical placement alongside the corresponding note snapshot. A B19 restore restores both that snapshot's content and placement; its preview shows both before confirmation. Missing placement in an older snapshot restores `always`. This is an explicit owner rollback, not a model action. Ordinary Markdown edits preserve placement for surviving topic identities and default newly created identities to `always`; they must not reset every note's placement.
- Restore must retain B27a's owner-restore/protection handling and current tombstones; do not replace the entire current note array with an old snapshot. Apply the selected snapshot's placement by matching topic identity to the resulting active notes after the existing restore transformation. A rename/new topic defaults to `always`; an explicit re-add of a forgotten topic also defaults to `always`. Forget/clear retain the marker's metadata but expose no content to retrieval.
- B14d backs up canonical documents. Restore must reload placement and discard any transient result cache; it must not resume work. Restoring an older backup can restore older facts and placement, as the existing backup contract already allows. This is not a new promise that forgotten facts survive every backup rollback.
- Use an additive optional `placement` field on the B27a note and its history copies, keeping existing document version 1 and complete Markdown projections. All product consumers change together under the current protocol compatibility policy. Older writers remain unsupported once structured notes are edited; this does not claim that an older binary can detect and reject every downgrade. No migration rewrites legacy memory solely because a reader opened it. Bot duplication/template export must continue excluding learned notes and placement.

### 2. Authority and eligible corpus

Read operations use the same authoritative Bot and channel identity as memory prompt projection. The adapter binds the Run, conversation and local Target; the model cannot choose a Bot ID, target or broader conversation scope. Validate live Run eligibility and cancellation through Host/Tool Router before a new read. Reads confer no write or management authority.

| Execution context | Eligible memory |
| --- | --- |
| A Bot's direct conversation and its permitted background continuation | Its current local notes plus shared notes, with existing shared-key precedence |
| A Bot's routine | The same local/shared audience as its current prompt; routine skill pins and write restrictions are unchanged |
| A group delivery, including peer/result continuation | That executing Bot's current local notes only; no shared notes, another Bot's notes or private conversation evidence |
| Missing/mismatched actor, deleted Bot, invalidated group delivery or terminal Run | Reject a new model read; saved transcript inspection remains governed by existing history access |

Apply the same active-state, shared-precedence and scope filters to always-loaded content, discovery and full-note reads. Resolve local/shared documents consistently and revalidate before returning a result. Filtering after ranking is insufficient: unauthorized records must not affect counts or ranking. Scope controls minimize model context; they do not sandbox Bots sharing the Mac.

Do not extend `memory_update` authority: only existing eligible direct user Runs may write local notes. A retrieval tool must not expose private source-message previews in a group merely because the note's content is allowed there. Return source kind/time and a verifiable note reference, not arbitrary private history; source inspection in the owner's existing Memory UI retains its own access rules.

### 3. Bounded search and read

Tool names are `memory_search` and `memory_read`, implemented as Host tools through the existing router under the existing `memory` capability. Policy and approval rules still apply; the write handler's direct-user restriction must not be reused as the read scope rule. Protocol owns public shapes, server-core owns eligibility and service orchestration, and agent-runtime owns canonical reads and prompt adaptation. Desktop uses existing Memory state/source methods, not a model Run impersonation. No new renderer read API or direct renderer/executor access to Pi storage is required.

Search input is a nonempty literal phrase, not SQL, a regex or a path. Cap it at 256 Unicode code points before normalization. Normalize query, heading and body with NFKC, JavaScript locale-independent lowercase, `/\s+/gu` collapse to one ASCII space and trim. Reject an empty normalized query and malformed surrogate sequences. Keep punctuation and diacritics; no word splitting, token AND/OR, stemming, accent removal or Simplified/Traditional conversion. Match the normalized phrase literally without changing displayed text. Exact heading matches precede other heading matches, then body matches. Break ties by `bot` before `shared`, then ascending note ID using ordinal string comparison, not host locale or time. Do not use recording time as proof a fact is more current.

Results contain at most five hits and 4 KiB of serialized UTF-8 output, including metadata. A snippet is the first 256 Unicode code points of the original body, with `partial` true if any body text is omitted; it is deliberately a prefix, not a promise to show the matched phrase. Display heading is capped at 120 code points with `headingTruncated`; an imported longer heading remains fully searchable and canonical. `source` contains only the last factual change's kind/time, not provenance IDs or private request text. Add hits in rank order until the next whole hit would exceed the budget; do not skip it in favor of lower-ranked hits. Top-level `truncated` means at least one matching hit was omitted by count or byte limits. No total count or cursor; refine the query. Group results omit shared revision metadata entirely.

The reference is versioned structured data bound to issuing Bot, conversation, scope, note identity and the local/shared revision pair. It is not an authorization token and needs no persistent issuance registry. The model forwards its field values unchanged; object property order is irrelevant. Host validates its strict schema and reconstructs current eligibility, including shared-key suppression. Do not compare references using raw JSON string equality. Group references carry no shared revision. Scope plus identity is necessary because note IDs derive from normalized headings and may coincide across documents. Reusing a reference in another conversation or Bot fails even if its note ID exists there. No caller-supplied provenance becomes trusted evidence.

`memory_read` accepts that reference and a nonnegative Unicode-code-point offset, default zero. Read the original body, excluding the heading. Return at most 2 KiB of text and 8 KiB of serialized output, including framing; shrink text at code-point boundaries when JSON escaping would exceed the bound. Include `complete` and the next absolute code-point offset, or null at the end. Offset equal to body length returns empty text with `complete: true`; an offset beyond it fails. A nonfinal chunk must advance the offset. Check both applicable document revisions before each chunk; correction, placement change, sharing or forgetting invalidates the old reference. Return a structured stale/unavailable result without replacement content. The model searches again rather than concatenating chunks across revisions.

Public wire shapes (strict objects, no unknown fields at any level):

```ts
type Revisions = { local: number; shared?: number };
type MemoryRef = {
  version: 1; botId: string; conversationId: string;
  scope: "bot" | "shared"; noteId: string; revisions: Revisions;
};
type SearchInput = { query: string };
type ReadInput = { ref: MemoryRef; offset?: number };
type SearchResult = {
  ok: true; revisions: Revisions; observedAt: number;
  hits: Array<{ ref: MemoryRef; heading: string; headingTruncated: boolean;
    snippet: string; partial: boolean;
    source: { kind: "legacy" | "user" | "model" | "restore"; at: number | null } }>;
  truncated: boolean;
};
type ReadResult = {
  ok: true; ref: MemoryRef; observedAt: number; text: string;
  complete: boolean; nextOffset: number | null;
};
type ReadFailure = {
  ok: false; error: { code: "invalid_arguments" | "unavailable" | "stale" |
    "cancelled" | "internal_error"; message: string };
};
```

Revisions, offsets and timestamps are nonnegative safe integers. Bound `botId`/`noteId` to 1–256 code points and `conversationId` to 1–2048, and the serialized reference to 4 KiB; the model has no top-level actor/target override. Direct/routine refs require `shared`; group refs require its absence and `scope: "bot"`. Every successful issued reference must fit its own input schema; fail visibly on corrupt/inexpressible canonical metadata. Size limits measure `Buffer.byteLength(JSON.stringify(result), "utf8")` on the actual tool-output object, not display characters; errors are at most 1 KiB with fixed messages and no raw exception/state content. Success becomes `ToolOutcome.status: "succeeded"`, domain failure becomes `"failed"` with the JSON failure as output. Router denial/cancellation keeps existing outer outcomes and cannot be turned into a successful empty search.

Check argument shape, bound actor/lifecycle/target/policy, then current snapshot eligibility. An unauthorized actor or out-of-scope reference gets `unavailable` without confirming existence or revisions. Only an otherwise eligible bound caller may get `stale` when its revision pair differs; unknown/inactive/suppressed notes at current revisions are `unavailable`. Capture both documents consistently in the Host-owned runtime, calculate results without external I/O, and recheck cancellation and live eligibility before delivery; retry no snapshot race automatically. The result is an observation at that captured revision, not a promise that no edit can occur after return.

Search includes eligible always-loaded notes as well as on-demand notes, so it can supply stable references without duplicating storage. Empty results mean no literal match in this eligible current corpus, not no historical fact. Forgotten, moved-out and overridden notes are not historical search candidates. All results are untrusted evidence, not permissions or instructions.

### 4. Prompt behavior, reads and replay

Always-loaded active content retains current scope and precedence. Keep document revision and existing protected-topic guidance; do not hide protection metadata merely because a note is on demand. This existing list can reveal topic names and help discovery; on-demand placement does not hide those names. Do not add a second catalog. With no eligible on-demand notes, preserve the ordinary prompt and offered-tool set; register the handlers globally but offer the read tools when selective projection is active. Recompute offering with the prompt on the next model request after placement/scope changes. No automatic pre-turn retrieval request.

Guidance must say: use memory for personal facts only when relevant; search a distinctive short keyword, shorten a missed phrase to one word, try an English singular/stem or another language as appropriate; existing topic names are hints, not factual evidence. If the needed fact is outside a partial prefix, read and follow `nextOffset`. Stop guessing when evidence is insufficient. The experiment's three retrieval rounds are an evaluation bound, not an application-wide Run budget. There is no new automatic retry or inference loop; normal Run lifecycle, Stop and usage accounting apply to all model-selected reads. Per-call bounds do not promise a fixed total Run cost.

The adapter must offer both read tools in every eligible context where it applies selective projection. Missing handler/schema registration is a configuration failure, not permission to omit notes with no retrieval path or silently send all on-demand content. Validate this at composition/admission and cover it with a regression. An owner's policy denial is an ordinary visible denied tool outcome; never bypass it by loading omitted content or trying a different tool. Tool availability does not expand the scope matrix or permit memory writes.

Moving a note to on-demand placement affects newly constructed memory sections. It does not remove earlier copies from the current Pi conversation, compaction summaries, tool results, journals or prior provider requests. Explain this in the UI; evaluate clean/new-topic context separately from already-running conversations.

New reads after a correction/forget must use current eligible state. Each successful read records its snapshot revisions and observation time inside the result. Pi may replay an already committed tool result; it remains historical evidence with those original fields, never a newly observed read. Do not add a Host content-receipt store or replay cache. If a read was not committed before interruption, an actual handler rerun rechecks live authority/state; a stale reference fails, and a search may return newer results. A new tool call is required to establish a new observation. Preserve the router's target/lifecycle checks and test both completed-result replay and unfinished-handler rerun. Do not promise to retract information the model already received. A changed reference cannot authorize automatic reinsertion of stale content into canonical memory.

Search/read failures remain observable through existing tool outcomes and B28a activity; they do not block Stop or invoke the optional B28b generator. Successful retrieval does not prove the model used the fact correctly or that the source entails it.

### 5. Owner experience

Extend the existing Memory note cards with a placement choice, keeping scope, source, correction and forgetting controls. Label it “Always in context” / “Read when needed” and “始终加入上下文” / “需要时检索”. Keep crucial preferences always loaded. Show always-loaded active Markdown bytes separately from total stored active bytes per scope; label these as scope storage/projection estimates, not actual provider tokens or a combined group prompt. State that retrieval may miss notes and add latency/cost. No inferred preference or automatic migration chooses placement for the owner.

Shared-note edits clearly show their broader audience; group exclusions remain visible. The UI must distinguish a change in what is sent on future requests from a privacy/erasure control. Drafts and placement changes must survive revision conflicts without silently accepting newer state. Provide English/Chinese copy and keyboard access within the current small-window layout.

Use existing tool-result detail for search/read evidence and the existing Memory source inspector for owner verification. Do not add a new Markdown citation-link protocol in this increment: a model can name the note and scope, but generated text must not create privileged navigation. Source details label a changed revision or unavailable original evidence instead of presenting current content as the old result. A dedicated answer-to-note link remains a separate UI follow-up if needed.

## Steps

1. When implementation is selected from the backlog, claim `task/b27c-bounded-memory-retrieval` and open its draft PR. This design branch does not implement or claim the task.
2. Add protocol schemas/placement action and pure selection, matching and result-budget helpers. Port the independent query labels and edge cases from the [design fixture](../research/fixtures/b27c-retrieval.mjs) into product tests; do not import the research harness as production code.
3. Extend runtime canonical state, snapshot restore and bound read ports; wire server-core handlers and local-server Tool Router composition. Add authority/replay tests before prompt selection. Keep existing memory-write tests intact.
4. Add selective prompt/tool offering and bilingual placement/history UI. Extend existing memory and recovery e2e, including policy denial, missing handler and live correction/Stop cases. Do not create a new package or evaluation framework.
5. Run the acceptance below, inspect hidden app screenshots and compare actual provider-bound requests. Record implementation evidence in this spec or one linked acceptance record; update architecture for the implemented decision only after it exists.

## Acceptance

| Area | Required evidence |
| --- | --- |
| Default compatibility | Legacy and new default-always notes preserve effective context, offered tools and quotas; no read-triggered rewrite, archive or new cross-Bot source |
| Placement lifecycle | Owner CAS/replay/changed-argument conflict/no-op, model edits, Markdown rename/re-add, atomic scope moves, old/new snapshot restore, backup restore and reopen preserve the chosen semantics; templates/duplicates copy no learned state |
| Scope and precedence | Direct/routine/group fixtures enforce the matrix; on-demand shared and forgotten shared topics still suppress local duplicates; unauthorized candidates do not affect results |
| Matching and bounds | All 18 positive literal cases and five absence/suppression cases have exact expected IDs; the 15 paraphrase/translation/normalization-limit misses remain explicit expectations. Also test first-five ordering, long headings, byte-budget omission, max-length/blank/malformed-surrogate query, unknown input fields, key-order-independent refs, wrong version/actor/revision, emoji/control-character escaping, exact-end/invalid offsets and lossless chunk concatenation |
| Correction and replay | Correct/forget between search and read, during cancellation and across restart; stale references never appear fresh, and new reads do not resurrect omitted facts |
| Sources and UI | Correct scope/note/version evidence, unavailable source, small-window English/Chinese, conflict-preserved edits, accessible placement controls and truthful activity; generated references confer no navigation authority |
| Product verification | `pnpm run check` and full hidden `pnpm run e2e`, with relevant screenshots inspected; refresh shard timings if suite duration changes materially |

Extend `packages/agent-runtime/test/memory-controls.test.ts`, `packages/server-core/test/memory-authority.test.ts` and appropriate router/protocol tests. Extend `e2e/memory-provenance.e2e.ts` and existing backup/recovery coverage. Scripted tests assert exact authorization, state, omission and tool-result behavior, not model recall. Exercise all three audiences and a peer/result continuation; a denial cannot trigger fallback loading. Correct/forget after search and between chunks, cancel a pending read, reopen after an unfinished read, and replay an already-committed result with its original observation metadata. Verify a shared correction remains authoritative even when on demand.

The [dated evaluation](../research/b27c-retrieval-evaluation-2026-11-01.md) closes the design value gate only for **explicit placement of rarely relevant notes**. Its mixed workload is more expensive; this task must not change the default or claim a general cost/latency improvement. At implementation acceptance, run one bounded paired comparison using the same 14 synthetic prompts and configured model, capturing actual product prompt/tool schemas and usage through an isolated app. Maximum 70 provider requests, 768 output tokens/request, no transport retry, and no more than three retrieval rounds per selective trial; a budget exhaustion is a failure, not a reason to silently extend the run. This evaluation limit does not change the product Run policy.

Required quality: correct current fact and constraints in all ten recall cases in each arm, correct results in both unrelated cases, and abstention without an invented number in both absent cases. Also run the two paired local-title sensitivity cases with genuinely unprotected model-origin local notes (at most ten additional provider requests); owner placement must not add protection or expose their titles. Manually inspect answers in addition to literal markers; the research marker missed valid English abstention. No unauthorized content or stale-as-current result is allowed. Keep both long-note chunks and the bilingual holdouts. A failure becomes a dated finding; do not loosen the oracle to pass or make implementation acceptance depend on repeating until lucky.

Required value: on each unrelated fresh-context task, selective loading causes no memory calls or extra provider request and saves at least 1,000 provider input tokens relative to all-loaded on this fixture/model. This is an absolute marginal saving, not a whole-product percentage or dollar promise. Count full tool schemas, protection metadata, re-sent history and read results. Report aggregate input/output/cache tokens, rounds and latency even when worse. For already-running conversations, show that placement cannot retract old context; record a warm-prefix comparison if the configured provider exposes cache use. Unknown cache prices or absent billing data remain unknown. If actual integration erases the marginal saving or loses answer quality, stop the affected implementation and reopen this design; preserve default-always behavior.

## Risks

The current corpus is small; added tool calls may cost more than omitted context saves. Models may not search, may miss paraphrases or may rely on stale conversation text. Whole-topic notes can contain several claims; original attribution is still the learning operation, not semantic verification. Placement adds metadata whose restore semantics must be explicit. Owner-controlled selection must not be presented as isolation, erasure or increased memory capacity.

## Open questions

None blocking implementation of the opt-in scope. The 2026-11-01 value, bilingual matching and evaluation questions are resolved by the linked design evidence and acceptance limits above. Cross-model generalization, warm-cache economics and reliable paraphrase recall remain unproven; they do not authorize defaults, an index or more stored content. Reopen design if the real demand is expanded capacity/history search, if production overhead defeats the measured saving, or if a broader matcher is needed. Existing release priorities retain precedence.

## Evidence

Design baseline: `d6bab2c`, reviewed 2026-11-01. Read B27a/B14d contracts, the protocol note types, memory conversion/mutation code, prompt projection, existing Memory UI and memory regression tests. [Comparison research](../research/bot-project-comparison-2026-10-30.md) supplies external examples; [memory research](../research/memory-design.md) owns the earlier retrieval experiments.

The [2026-11-01 evaluation](../research/b27c-retrieval-evaluation-2026-11-01.md) records deterministic bilingual queries, two bounded provider comparisons, the experimental-reference bug and affected-case rerun, usage trade-offs and reproducibility. Design readiness does not claim product implementation, full acceptance or general model reliability. Design PR #76 changed only documentation and synthetic research fixtures; no product code, dependencies or owner memory were modified.


Implementation candidate: [PR #77](https://github.com/VesperZephyr/OpenBot/pull/77). The [2026-11-01 product acceptance record](../acceptance/b27c-memory-retrieval-2026-11-01.md) owns implementation verification, the complete bounded provider comparison, cache observations and remaining gaps.

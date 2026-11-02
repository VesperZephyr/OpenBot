# Super-agent Research for a Personal, Local OpenBot

Research date: **2026-11-02**. Status: source review and design recommendations, **not a ready implementation spec**. OpenBot baseline: `1b550b934c0adfd267bc7559d0ff80d91263b396`. Prototype baseline: [`6337fc823ce20251c8de8085948165c81aaa701e`](https://github.com/deepseek-ai/dsh-superagent-prototype/tree/6337fc823ce20251c8de8085948165c81aaa701e). The [backlog](../backlog.md#research-informed-design-order) owns the maintained queue; existing specs retain their contracts and delivery status.

## Recommendation and product boundary

Adopt the goal of reducing the owner's coordination work: keep independent tasks moving, retain their decisions and evidence, and ask for attention when it changes the outcome. Preserve OpenBot's named Bots, Pi adapter, Host Runtime, local Executor and authorization path. The useful addition is continuity between user intent and several executions, not a replacement runtime or a hosted agent platform.

**Personal use, on this Mac, with no separately operated service** is the constraint for every recommendation. Desktop owns the application lifecycle; Host Runtime, scheduling, state and execution remain local application components. Do not introduce a cloud control plane, remote daemon, public webhook receiver, separate management web server, deployment dashboard, service account fleet, multi-user administration or an always-on service outside the app. Internal process separation and private IPC remain valid. Configured model endpoints and owner-connected APIs remain possible under the existing [runtime scope](../architecture.md#1-product-goals-and-runtime-scope); local operation does not imply offline inference.

Window closure may leave the menu-bar application working while the Mac is awake. Explicit Quit ends that availability. Sleep and restart preserve records and require reconciliation; they do not promise uninterrupted work or automatic replay of interrupted effects. Keep the [lifecycle contracts](../tasks/b11d-unattended-reliability.md) and [trust model](../architecture.md#11-trust-model).

This review changes no protocol, persistence format, scheduling limit, grant or user-visible behavior. It imports no prototype code, installs no dependency and starts no service.

## Evidence and limits

The [DeepSeek Harness article](https://x.com/DeepSeekHarness/status/2116857257245987236), published November 1, describes a coordinating layer, independent workers, event intake, asynchronous interaction, context recall and recovery. Its experiments use synthetic messages and time-consuming mock work; they support a scheduling hypothesis, not a real-task quality or security comparison with OpenBot. The X page rejected direct fetching; its article text was read through the [public FxTwitter representation](https://api.fxtwitter.com/DeepSeekHarness/status/2116857257245987236). No article media or copied source text is stored here.

The [prototype README][prototype-readme] explicitly distinguishes the published bundle from the internal system and the article. The reviewed bundle targets one GitHub repository, optionally Feishu, and includes a local database, Harness integration and management UI. Source and selected test inspection below establish narrower implementation observations. The prototype was not installed or run; its tests and comparative benchmarks were not executed. OpenBot sources were inspected without launching the owner-data app.

| Mechanism inspected | Pinned evidence | Finding and OpenBot implication |
| --- | --- | --- |
| Work independent of an execution attempt | [Domain model][prototype-domain], [stage reducer][prototype-stage], [stage tests][prototype-stage-tests] | Tickets retain intent across Assignments; attention is derived from structured facts. Evaluate continuity across our existing Runs, collaboration roots, routine occurrences and artifacts before adding a new canonical object. |
| Events and follow-ups | [Intake][prototype-intake], [follow-up tests][prototype-followups] | Ingestion deduplicates events, records their disposition and routes subscribed context. Separate receiving information from permission to start, resume or expand work. |
| Two-stage admission | [Authorization][prototype-auth], [policy tests][prototype-policy-tests] | Deterministic source admission precedes semantic evaluation; inferred work defaults to observation. This is a useful starting pattern for an opt-in local source, not permission to ingest all owner communications. |
| Responsive execution | [Executor][prototype-executor], [concurrency tests][prototype-concurrency-tests], [presets][prototype-presets] | Worker slots account for starts and wakes; a bounded extra slot favors human follow-ups. The router preset still includes shell tools, so the published prototype is not a mechanically tool-free coordinator. Measure our latency before choosing different tool sets or changing caps. |
| Durable delivery | [Outbox][prototype-outbox], [outbox tests][prototype-outbox-tests] | A message receipt and its queued delivery effect commit together. External sending happens afterwards; this alone cannot prove exactly-once remote delivery across a crash. Preserve OpenBot's distinction between committed intent, confirmed receipt and unknown outcome. |
| Bounded recall | [Resources][prototype-resources] | Linked, paginated task/thread resources keep large bodies out of ordinary prompts. Reuse our authorized application reads and canonical references; a new vector service is unnecessary for the first experiment. |
| Attention and operation | [Panel][prototype-panel], [deployment][prototype-deployment] | The UI emphasizes actionable work. Deployment also proposes an hourly check in another Harness profile; that operational arrangement does not transfer to a self-contained Mac application. |

Two authorization differences are material. The prototype delivers subscribed messages as context without rerunning its new-work gate, and policy changes notify live Tickets rather than immediately revoking them. Its [execution guide][prototype-execution] documents commands running as the operator without per-command approval, with directories and blocked-command wrappers providing no isolation. OpenBot must preserve current authority revalidation, restrictive-policy reconciliation and executor enforcement; a durable task scope must never become a substitute for a tool grant. These are differences in contracts, not a claim of an exhaustive security audit.

## Fit with existing OpenBot design

This is a dated gap assessment. Linked specs and source remain authoritative; the architecture includes future capabilities and is not a completion checklist.

| Area | Existing owner and evidence | Increment worth considering |
| --- | --- | --- |
| Runs and interaction | [B2](../tasks/b2-runs.md), [scheduler](../../packages/server-core/src/runs.ts) | The scheduler caps active Runs and excludes a busy Bot from further admission. Ordinary same-channel user input can steer an active Run. A separate new task and a correction to existing work need distinguishable ownership before one Bot can coordinate several tasks. |
| Core and collaboration | [B13c](../tasks/b13c-collaboration.md), [group service](../../packages/server-core/src/groups.ts) | Group delegation and handoff already exist, with bounded roots and scoped stop. Private chats remain direct. Direct-Core dispatch and independent task contexts require new contracts, not merely a delegation-first prompt. |
| Long commands | [B15b](../tasks/b15b-background-completion.md), [completion service](../../packages/server-core/src/background.ts), [e2e](../../e2e/background-completion.e2e.ts) | Durable command completion already admits a separate continuation without model polling. It is not generic asynchronous execution for every connector/tool or parallel model workers; extend only for a measured blocking flow. |
| Scheduled work | [B11a](../tasks/b11a-local-routines.md), [B11d](../tasks/b11d-unattended-reliability.md), [B11e](../tasks/b11e-bot-routines-library.md) | Routines and their failure handling are foundations. A durable event cursor, task association and event admission are additional concerns; do not rebuild the scheduler. |
| Messages and attention | [B28a](../tasks/b28a-messages-fixed-activity.md), [B28b](../tasks/b28b-generated-activity.md) | Deliberate messages, activity and outcomes already have owners. Cross-task attention can project existing authoritative facts. Generated status prose is neither a prerequisite nor proof of progress. |
| Memory and history | [B27a](../tasks/b27a-memory-provenance.md), [B27c](../tasks/b27c-bounded-memory-retrieval.md), [B24](../tasks/b24-app-capability-api.md) | B27c retrieves current bounded notes; it explicitly does not reconstruct long task history. Task decisions and artifact relationships should use canonical evidence, without broadening memory scope or copying private histories. |
| Recovery, policy and retention | [B12a](../tasks/b12a-deterministic-policy.md), [B14b](../tasks/b14b-lifecycle-gates.md), [B14d](../tasks/b14d-backup-restore.md), [known gaps](../technical-plan.md) | Preserve these contracts and their remaining limitations. Any new durable task or event record must resolve migration, backup, deletion, bounded retention and recovery before implementation. |

The article's **Router** is a conversational coordinator. OpenBot's **Tool Router** authorizes and routes model-selected tools; it must not acquire global task planning or unrestricted state access. Likewise, their worker-side Executor Session is a model session; OpenBot's **Executor** performs authorized side effects. A future coordination design belongs in Host application methods, with Pi access confined to `agent-runtime` and process wiring in `apps/local-server`. No new package or network service follows from these conceptual roles.

## Recommended design sequence

Existing delivery work, signed updates and native release evidence retain their backlog position. The sequence below is the rationale on the research date, not authorization to implement or a new set of ready task IDs.

| Order | Candidate | Reason and readiness condition |
| --- | --- | --- |
| First | Local task continuity and a responsive Core | Most directly reduces the owner's need to split chats and repeat context. Design the concrete two-task scenario below, audit existing identities and measure the baseline before choosing a new task object or execution topology. |
| Next | Reusable behavior regression traces | Retain the [October 30 recommendation](bot-project-comparison-2026-10-30.md#reusable-behavior-regression-evidence). Reuse sanitized failures for routing, corrections and recovery when existing fixtures are insufficient; do not make a new harness a prerequisite for the first design. |
| Then | Policy explanation and preview | Retain the [existing evidence audit](bot-project-comparison-2026-10-30.md#policy-explanation-and-historical-preview). Clear admission reasons help future proactive work; faithful historical replay still needs captured authority context. |
| After continuity is settled | One bounded local event source | Prove a useful owner workflow, first in observation mode, with stable event identity, scope, cursor recovery and cost limits. Generic event infrastructure and external chat ingress do not belong in the first increment. |
| After measurable long-task failures | Progress diagnostics | Start with deterministic evidence and actionable explanations. An optional model assessment needs a separate quality/cost evaluation; autonomous repair remains deferred. |

Task continuity moves ahead of the earlier cross-cutting candidates because it addresses the owner's stated personal-assistant goal directly. This is a product priority hypothesis, not a measured performance result. If a two-task trial shows existing Bots and group handoffs already meet the need, retain those mechanisms and deliver only the missing attention/context improvements. The [backlog](../backlog.md#research-informed-design-order) is the sole maintained ordering.

### First candidate: task continuity and responsive Core

Keep **Bot** as a persistent role with instructions, skills and memory. Treat a **task** as an intended outcome with decisions and evidence, potentially spanning executions. Keep **Run** as an execution unit. These are design distinctions; they do not yet prescribe a new schema or a one-to-one mapping.

Preserve direct private Bot chats and explicit group recipients. A responsive Core should be a convenient entry point, not a mandatory intermediary for every interaction or a reason to remove the owner's chosen Specialist.

The design should answer:

1. Can existing collaboration roots and Run links represent the task, or is a new durable identity necessary? Do not create another answer store, receipt ledger or competing completion state.
2. How does an owner start a second task, correct the first, or stop only one from the same conversation? Unclear references must not silently steer the wrong work. An explicit task selection can be preferable to a model inference.
3. Can separate task contexts reuse one Bot's role without creating permanent roster entries? Any per-Bot scheduling change needs explicit admission, cancellation, usage and recovery contracts. Preserve one active Run per execution conversation and sequential tools within a Run.
4. How does Core remain responsive when worker capacity is full? Evaluate reserved capacity or bounded prioritization within an explicit total resource budget. Do not copy the prototype's extra slot by silently exceeding OpenBot's cap; direct queued work already has priority and aging rules.
5. What context may each execution read, and what result returns to the owner? Shared Mac access is not isolation. Private/group visibility, exact skill revisions and provenance still apply to every handoff and recall.
6. How are concurrent writes to the same document or repository coordinated? Separate model context does not prevent workspace conflicts. Start with independent artifacts; serialize conflicting work unless a separately specified workspace strategy proves safe.

**First delivery cut to evaluate:** a compact attention projection over existing approvals, failures, interrupted Runs and available results. Show the next meaningful owner action and a link to its evidence; keep execution details accessible. Do not introduce a persistent "accepted" or "ready for review" state without defining who records it and how it differs from execution completion. This UI slice can be independently specified if it does not depend on new task semantics.

**Minimum recall:** bounded references from a task to its latest instruction/decision, source conversation, related Runs and artifacts. Use existing application capability reads where possible, and recheck their scope on every hop. Missing or deleted evidence must be reported as unavailable. Explicit corrections supersede earlier decisions by trusted provenance, not by whichever summary was imported last. Do not add an unrestricted global transcript, new embedding store, or background memory extraction.

### Later candidate: local event intake

Use an existing personal workflow, such as the [competitor radar](../workflows/competitor-radar.md). A Routine may poll one owner-selected source while the app runs and produce a durable change candidate. This keeps transport and scheduling local; using an external API does not require operating an inbound service.

Before auto-execution, settle:

- Stable source/event identity, duplicate and out-of-order handling, and atomic cursor advancement with durable intake. After sleep or source failure, recover a bounded interval and state any coverage gap rather than flooding the model or claiming complete history.
- Explicit distinction between contextual evidence, an owner instruction and an owner-enabled proactive rule. Rule matching may nominate work; current policy, grants and lifecycle still authorize each effect.
- Deterministic filtering before model assessment, bounded batches and per-source queue/retention/model budgets. Do not run the model merely to discover that nothing changed.
- Association with an existing task versus a new task; ambiguous association stays visible for review. Begin with one task owner per candidate, not arbitrary subscription fan-out.
- Observation mode that records why work would be admitted without running it. Automatic mode requires an explicit owner choice, a bounded scope and a clear way to disable it.
- Stop and rule revocation semantics: late, duplicate or replayed events cannot revive stopped work. Source removal invalidates future intake; authority must be checked again before dispatch.
- Publication as a separate action. Drafting a report does not authorize sending messages, publishing changes or merging a PR. Reconcile uncertain sends before retrying.

The first source should only prepare a local result within existing grants. More sources, semantic triggers, speculative drafts and external delivery each need demonstrated owner value; a generic plugin ecosystem is not the initial objective.

### Later candidate: progress diagnostics

Use committed milestones, repeated error signatures, outstanding receipts and bounded runtime/usage evidence to identify a stalled task. Account for approvals, intentional waiting, background commands and provider latency before classifying a problem. Absence of local process activity is not proof that a remote model or connector has stalled.

Initially provide a reason and existing stop/recovery actions. Any automatic pause or budget limit is itself a user-visible contract requiring a spec. Reuse application supervision for process health; an in-Host observer cannot detect its own process death, and no in-app observer runs after Quit or during sleep. Do not promise independent always-on monitoring.

An optional semantic assessor may recommend an intervention later, but must not rewrite prompts, weaken policy, change grants, resume after owner stop, or replay unknown effects. Do not add an independently deployed Watchdog or an unrestricted self-repair agent.

## Validation scenarios for future specs

These are proposed evaluation requirements, not tests run in this review. Extend [ScriptedModel](../../e2e/scripted-model.ts), [collaboration e2e](../../e2e/collaboration.e2e.ts), [background completion](../../e2e/background-completion.e2e.ts) and [recovery](../../e2e/recovery.e2e.ts); use the repository's isolated background verification workflow.

| Scenario | Observable outcome |
| --- | --- |
| The owner requests a competitor report, then a separate document summary while research continues | Both have identifiable ownership and independent outputs. Core accepts the second intent without requiring a new permanent Bot or mixing the documents. Compare with the current baseline before choosing topology. |
| The owner changes the report's comparison criteria and stops only the document summary | The correction reaches the correct task; stop suppresses that task's late continuations without cancelling the report. Ambiguous references do not silently choose. |
| All normal execution capacity is occupied | New owner input and stop remain observable and bounded; the implementation obeys its declared total cap and does not starve queued work indefinitely. |
| A command completes after its foreground turn, then the Host restarts | Existing completion identities produce one logical continuation/result; no polling conversation or duplicate command is introduced. |
| The Mac sleeps or the owner quits after an external effect whose result is missing | State remains honest. Resume follows existing lifecycle and receipt reconciliation; no blanket automatic retry or promise of work while the app is unavailable. |
| The same source item arrives twice, late, or after rule revocation | Observation/admission records explain the disposition; stopped or unauthorized work does not restart. External text cannot grant permissions. |
| A retrieved decision is corrected, deleted or outside the current context scope | Current authorized evidence wins, missing evidence is explicit, and private history is not copied into a group result. |

Measure time to handle new owner input, useful completed artifacts, required interventions, repeated context explanations, unnecessary messages, routing/correction errors and model usage. Record results locally with synthetic or explicitly approved sanitized inputs; do not add telemetry or retain owner transcripts. Deterministic tests establish ownership and safety; separately budgeted real-model trials establish whether the experience actually improves. No latency or quality improvement is claimed yet.

## Not adopted and reconsideration conditions

| Approach | Decision and reason | Revisit only when |
| --- | --- | --- |
| Cloud loop, remote execution daemon, BYOM or multi-device control | Outside the personal, single-Mac, no-service product boundary | The owner explicitly changes the product premise; not as a reliability workaround |
| A separately operated service, management HTTP server or hourly external repair profile | Adds deployment and availability obligations to a desktop tool | A new explicit product decision authorizes those obligations |
| Team membership tables, cross-platform identity mapping, A2A and shared multi-user agents | Solve a team-service problem rather than the current owner's need | A separately designed collaboration product is requested |
| Unlimited worker creation, router sharding or automatic fan-out | No measured personal workload justifies the cost or shared-workspace contention | Bounded local trials show a bottleneck after simpler scheduling and context fixes |
| Replacing Pi or importing the prototype's framework | Useful mechanisms can fit existing module boundaries | A concrete runtime limitation survives a scoped adapter investigation |
| Prompt-only permission changes, unrestricted worker commands or automatic merge | Conflict with dispatch authorization and owner-controlled effects | Not admissible within the current trust and workflow contracts |
| Broad speculative execution and autonomous prompt/skill repair | Unproven value, potentially wasted budget and difficult recovery | One bounded workflow demonstrates value with explicit authority, reviewed changes and independent regression evidence |
| Browser/desktop control as a prerequisite | Separate Phase 3 feasibility and native permission work already has an owner | Its own ready specs and evidence gates are satisfied |

The proposed work should make daily use easier without asking the owner to operate infrastructure. A successful first increment can be small: two independent local tasks, reliable corrections and stop, bounded recall, and a clear place to see what needs attention.

[prototype-readme]: https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/README.md
[prototype-domain]: https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/001-domain.md
[prototype-auth]: https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/002-authorization.md
[prototype-execution]: https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/003-execution.md
[prototype-panel]: https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/005-panel.md
[prototype-deployment]: https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/006-deployment.md
[prototype-stage]: https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/core/stage.ts
[prototype-stage-tests]: https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/tests/stage.spec.ts
[prototype-intake]: https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/core/intake.ts
[prototype-followups]: https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/tests/followups.spec.ts
[prototype-policy-tests]: https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/tests/policy.spec.ts
[prototype-executor]: https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/executor/dsh.ts
[prototype-concurrency-tests]: https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/tests/runtime-concurrency.spec.ts
[prototype-presets]: https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/cordis.patch.yml
[prototype-outbox]: https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/outbox.ts
[prototype-outbox-tests]: https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/tests/outbox.spec.ts
[prototype-resources]: https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/resources.ts

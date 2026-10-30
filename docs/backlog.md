# Development Backlog

This is the active delivery queue, not a release history. Task status, contracts and acceptance live in each linked spec; the [task index](tasks/README.md) is the complete navigation list. Move completed work out of this queue after recording the merge in its spec. Do not copy test counts or implementation summaries here.

## Active Work

| Work | Next action / dependency |
| --- | --- |
| [B11e: Bot routines and generated-file Library](tasks/b11e-bot-routines-library.md) | Complete the review/verification tracked in [PR #69](https://github.com/VesperZephyr/OpenBot/pull/69); the spec owns findings and evidence |
| [B13e: Bot templates](tasks/b13e-bot-templates.md) | Owner review and merge of the implementation candidate; acceptance is linked from the spec |

## Next

1. **B14f: signed updates.** Prepare a ready spec after the template increment. Use B14d backup/restore and B14e credential identity as prerequisites; settle update verification, migration failure and rollback behavior. The [planning brief](development-roadmap.md#6-p2-broader-access-and-maintainability) does not authorize implementation or release publication.
2. **Native release gates.** Track clean installation, Developer ID signing/notarization, credential continuity and physical lifecycle evidence separately from feature completion. [G0](development-roadmap.md#4-p0-closeout-and-dependable-execution) defines the gate; [I2](tasks/i2-mvp-acceptance.md) links the captured MVP evidence.

Prerequisites normally merge before dependent implementation. Each implementation needs a ready spec with resolved contracts and acceptance. The owner merges; queue position alone does not authorize scope expansion.

## Deferred Work

| Area | Design prerequisite |
| --- | --- |
| Connector OAuth and optional model review | Separate B9c/B12b specs; supported connector/policy contracts remain bounded |
| Memory retrieval, semantic contradictions, source citations and role readiness | Evidence and decisions from [memory](research/memory-design.md) and [role research](research/bot-role-design.md); preserve backup compatibility |
| Richer menu-bar status, Normal/Verbose tool detail, login item and chat organization | Focused desktop specs rather than an acceptance-task expansion |
| AI avatar generation, adjustable cropping and proactive greetings | Separate product design; original profile design is [D6](tasks/d6-desktop-design.md) |
| Browser, takeover/secrets, desktop control, dictation and teaching | [Phase 3 feasibility gates](development-roadmap.md#7-p3-browser-desktop-and-demonstration-deferred), then ready specs |
| Broader collaboration, triggers, artifact formats and isolation | Explicit new contracts; consult [known gaps](technical-plan.md#12-known-gaps-in-existing-code) and [deferred scope](development-roadmap.md#8-deferred-scope) |

The [architecture](architecture.md) defines long-term boundaries. The [roadmap](development-roadmap.md) preserves why capabilities were ordered and what future design must resolve. Neither is a second active task board.

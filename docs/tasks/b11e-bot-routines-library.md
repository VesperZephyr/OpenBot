# B11e: Bot routines and generated-file Library

Status: in progress
Branch: task/b11e-bot-routines-library
Depends on: B11a–d, B15a, D9/D10, B14c
Architecture: Sections 4.2, 5.2, 5.8, 6.1

## Goal

Expose scheduled AI work and generated files from each Bot's details. The Bot page emphasizes viewing, opening and switching routines; creation begins with an AI proposal in chat. A direct chat can prepare a routine for explicit review; saving uses the existing scheduler and authority contracts.

## Scope

In: Bot-scoped routines entry, create/edit/history navigation, confirmed pause/resume, generated-file Library with search and existing preview/export/removal; conversational creation proposals.
Out: Computer, browser control, cloud scheduling, new schedule kinds, conversational editing, automatic filesystem discovery and new grants.

## Design and contracts

- Keep the existing profile and memory tabs, adding Routines and Library in the same details surface. Reuse the complete routine editor for configuration review, confirmation and history with the current Bot selected. Hide manual creation in the Bot-scoped view; preserve the existing global Settings workflow. Show timezone, state and next run in the Bot list.
- `routine_propose` is a Host tool with capability `routines`. It accepts existing RoutineFields, excluding group destinations and report inputs. Bind the Bot and target to the active direct user Run. Bound serialized proposal fields to 24 KiB and show arguments only once in the history projection so the interactive card stays within the 32 KiB row limit. Validate fields and pinned skills before returning a structured `RoutineProposal { requestId, botId, fields }` in the ToolOutcome and transcript. It never changes scheduler state. Unattended and group work cannot propose routines.
- Derive the proposal request ID from the trusted conversation/call identity. Preserve the structured proposal in Pi tool-result details; never parse assistant prose into an executable proposal. Review opens the existing routine editor. Confirmation uses the proposal request ID with `routines.change`; repeated confirmation reuses its receipt. Editing proposal fields creates a fresh reviewed request identity. The model must say confirmation is pending, never claim a schedule exists before confirmation.
- Add optional trusted `botId` provenance to result ArtifactRef metadata at executor publication. Existing refs without provenance remain valid and available in Shared files; do not guess their author. Imports do not get result provenance. Publication retries retain the original receipt.
- Extend `artifacts.list` and its private operation with optional source and botId filters, applied before the existing bounded pagination. The Library requests source=result and its Bot ID, never rescans transcripts or filesystem paths. Filtering is organization, not isolation. Existing file reader and immutable-copy behavior stay authoritative.
- Do not change Pi vendor code or package boundaries. Keep English source copy and Chinese locale entries.

## Steps

1. Extend artifact provenance/filter contracts and executor tests.
2. Add validated, routed proposal handling and structured transcript projection, with direct-user authority tests.
3. Add Bot details tabs, scoped routine navigation, proposal review and Library using existing UI components.
4. Extend scripted hidden desktop acceptance, run full check/e2e, inspect screenshots and explore an isolated app with agent-browser. The shared ScriptedModel HTTP reader must decode UTF-8 across network chunks so multilingual acceptance observes the actual provider input.
5. Update plan/backlog with implementation and verification; open one PR linked to this spec. Mark done only after merge.

## Acceptance

1. Executor tests prove Bot/source filtering before pagination, legacy compatibility and provenance persistence/replay.
2. Host tests reject invalid schedules, wrong targets and non-direct/non-user origins; proposals do not create schedules.
3. Hidden desktop: chat proposal creates no routine until review/confirmation, repeated review does not duplicate; saved routine survives restart, is scoped to its Bot, and pause/resume/history work.
4. Hidden desktop: published direct and routine files appear in the owning Bot Library; another Bot and input attachments are excluded; search, preview/export/removal and restart use immutable copies. Empty states and Chinese minimum-size layout are checked.
5. Full `pnpm run check` and `pnpm run e2e` pass; screenshots and isolated agent-browser exploration are recorded. Native release gates remain separate.

## Risks

Legacy files have no author metadata and remain in Shared files. Stale async reads must not replace a different Bot/search page. Proposal identity must survive replay and repeated confirmation without silent duplicate schedules.

## Open questions

None.

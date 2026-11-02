# D12: Free BoardUI Components and an OpenBot Chat Interface

Status: draft — design proposal; implementation has not started
Branch: docs/d12-boardui-refactor
Depends on: the existing D7–D10 desktop behavior; each implementation cut must reconcile with the then-current merged desktop
Architecture: existing Electron renderer and typed Host Runtime API; no protocol, persistence or process-boundary changes
Design baseline: `f45a707`, 2026-11-02

## Goal

Give OpenBot a coherent, approachable desktop interface using selected MIT-licensed BoardUI components and an OpenBot-owned chat composition. Improve hierarchy, control consistency and maintainability while preserving the behavior that makes conversations, approvals and local work dependable.

The selected direction is free components plus our own interface. This document defines scope, integration constraints and staged acceptance. It does not claim implementation readiness for three changes at once: each stage needs one ready implementation spec, one task branch and one PR. Delivery status and evidence will live in those implementation specs. This design does not reorder the active delivery queue.

## Decision and external constraints

BoardUI distributes editable source files, using React 19, Tailwind CSS v4 and React Aria Components for interactive behavior. It does not require an application runtime service. OpenBot already uses React 19 and Electron/Vite; Tailwind is the new styling dependency. Keep the Electron application and its existing data flow.

The [free repository](https://github.com/BoardUI/boardui) carries an [MIT license](https://github.com/BoardUI/boardui/blob/main/LICENSE). The [multi-agent chat template](https://www.boardui.com/zh-hans/components/multi-agent-chat) and several advanced agent blocks are Pro. The [license page](https://www.boardui.com/license), checked on 2026-11-02, restricts public redistribution of Pro source and recognizable derivatives. Use only files verified as MIT in the selected free revision, with their notices and applicable third-party notices. A component being visible in a demo is not evidence that its source or artwork is free.

Use the reference's calm surfaces, compact navigation and clear grouping as design direction. Author chat composition and Bot identity assets in OpenBot; do not copy Pro code, avatar artwork or demo assets, or reconstruct the Pro template as a source substitute. Reconsider Pro only with explicit authorization compatible with this repository's distribution and a separate scope decision.

Source delivery means OpenBot maintains its adaptations. Record an exact upstream revision, imported paths, license provenance and material adaptation reasons when importing. Updates are reviewed diffs, not an unattended CLI overwrite. [Installation documentation](https://www.boardui.com/zh-hans/installation) describes per-component installation and custom paths; [the integration overview](https://www.boardui.com/llms.txt) describes generated styles and agent instructions. Third-party setup must not replace this repository's AGENTS.md or install unrelated editor rules.

## Scope

### In

- A small renderer-local UI foundation: buttons, icon buttons, fields, menus, dialogs, select controls and switches, added only when used by a stage.
- Tailwind v4 integration in the renderer, semantic theme mapping, consistent typography, spacing, radii, boundaries and focus treatment.
- OpenBot-owned conversation navigation, header, transcript composition, activity presentation, composer and Bot details styling.
- Presentation updates to existing settings, Skills, Connectors, Routines and Library surfaces after the conversation stage passes.
- English and Chinese, light/dark/System appearance, reduced motion, keyboard access, compact windows and existing file-reader coexistence.
- Refactoring UI composition where needed to separate presentational components from existing state/actions; removing replaced CSS after its callers migrate.

### Out

- Pro templates, agent creators, composers, task lists, avatar renderers and other Pro assets. Equivalent product needs use OpenBot-owned UI over existing data.
- Next.js migration, new backend routes, direct model calls from the renderer, BoardUI workspace persistence, authentication, marketplace or account features.
- Changes to Host methods, scheduling, group routing, authorization, grants, approvals, recovery, local storage formats or model behavior. These remain with their owning feature specs.
- New task-management capabilities, progress percentages without supporting data, voice input, avatar generation, animated avatar systems, browser or desktop control.
- New file formats or reader engines; [D9](d9-file-reading.md) and [D10](d10-reader-polish.md) remain the reader contracts.
- New shared packages, a generic design-system platform, a permanent old/new UI switch, owner-app installation or release publication.

## Visual and interaction direction

Keep OpenBot's existing Bot identities and restrained plum accent. The signature is a recognizable roster of personal Bots inside a quiet workspace. BoardUI supplies component consistency; OpenBot supplies identity and the interaction model.

Use the palette and appearance semantics in [D7 themes](../design/d7-themes.md) as the maintained color source. Keep the white light-mode chat canvas, softly separated navigation, raised dark-mode controls and explicit danger/attention colors. Do not import BoardUI's default blue brand as a second palette. Preserve the current system body font, restrained display font and monospace for technical content; no remote font or image fetch is needed.

Use a shared 4-pixel spacing scale. Prefer 8–12-pixel control radii and 16–24-pixel composition radii; use pills for compact identities or selections, not every container. Limit shadows to elevation cues. Keep existing reader control sizing where D10 defines it; ordinary new icon controls have at least a 32-pixel hit area. Component dimensions must support translated labels rather than fixed English text widths.

| Surface | Intended presentation | Behavior retained |
| --- | --- | --- |
| Navigation | Compact mixed Bot/group rows, search and new-conversation actions, quiet footer | Core identity, existing ordering, previews, unread counts, working/attention indicators and shortcuts |
| Conversation | Clear header, generous text area, grouped but unobtrusive execution detail | Private/group distinctions, safe streaming Markdown, bounded history, search selection and scroll anchoring |
| Composer | One stable input surface with attachments/Skills/recipients and a consistent action row | Per-conversation draft, input-method composition, follow-up, Stop, pending/uncertain send and retry |
| Bot details | Grouped fields and existing identity editor, with clear save/cancel states | Existing profile, model, Memory, Skills, Routines and Library actions and validation |
| Activity and approval | Compact textual activity; approvals remain visually distinct and actionable | Actual Host states, exact decision scope, expiration, disabled actions and recovery evidence |
| Settings and resources | Consistent fields, menus, lists and empty/error states | Existing destinations, data, authority, confirmations and navigation back to the draft |

The default chat remains navigation plus conversation. Details open only through the existing explicit action; file results continue opening in the existing resizable reader. Preserve current responsive inline/overlay behavior rather than introducing a second permanent inspector. Opening details while a reader is open must preserve reader tabs, page state and chat draft; overlays must not leave native HTML/web content covering dialogs. Any change to panel ownership or breakpoints requires an explicit contract in the conversation implementation spec.

No decorative animation may stand in for a real execution state. A stop request is not proof of completion. Do not add the reference template's “Bypass all” control or replace exact approvals with a generic confirmation.

## Integration contracts

### Renderer ownership

Keep imported UI source inside `apps/desktop/src/renderer/src/ui/boardui/`, with OpenBot adapters and shared primitives under `ui/`. These are proposed directories, created only when implementation starts. Application-specific conversation components remain outside the imported source directory. No new workspace package is needed.

The dependency direction is conversation/settings UI → renderer UI primitives. UI primitives accept values, presentation state and callbacks; they do not import the application store, Host API, preload bridge or product scheduling logic. Existing renderer containers continue to derive state and dispatch actions. Retain the desktop's product dependency on `protocol` only.

Use the existing [composer controller](../../apps/desktop/src/renderer/src/composers.ts), [application store](../../apps/desktop/src/renderer/src/store.ts) and [reader layout](../../apps/desktop/src/renderer/src/WorkspaceLayout.tsx). Do not introduce a second message list, browser-persisted transcript, request-ID generator or template response service. UI preferences already stored in the browser remain preferences; durable conversation and execution data remain under their existing owners.

### Styles and theme migration

- Install only required free component source and dependencies, pinned in the workspace lockfile. Review the selected source's actual dependency closure; do not import charts, demo routes or an entire registry.
- Configure paths/aliases for the desktop renderer, not the repository root or Electron main/preload. Keep existing assets local and retain the current icon abstraction; adapt imported icon slots rather than require a product-wide icon replacement.
- Keep the existing appearance preference and `data-theme` as the source of truth. Adapt imported theme selectors and semantic tokens to that state, including portalled overlays. Do not add a second theme provider, storage key or default preference.
- Map imported semantic colors to OpenBot roles. New roles need deliberate light and dark values; avoid duplicate independent palette definitions. Keep primary-action ink, destructive ink, muted text and disabled states distinct.
- Introduce Tailwind layers explicitly. Do not enable a second global reset during coexistence. Scope legacy element selectors away from migrated surfaces, including portals; account for unlayered legacy CSS overriding layered utilities. Document any temporary bridge beside its implementation with its removal condition.
- Preserve existing Markdown, code, PDF and embedded-content styling boundaries. Delete old selectors only after all affected surfaces migrate. The result must not depend on import order accidents or accumulating `!important` overrides.

### Accessibility and state

Keep one focus owner per modal. React Aria overlays and the existing [dialog focus manager](../../apps/desktop/src/renderer/src/ConversationUI.tsx) must not both trap focus or handle Escape for the same dialog. Migrate ownership with each dialog, preserving nested-dialog behavior and focus restoration to its opener.

Retain English source strings and `t()` localization, accessible control names, selected/expanded/disabled semantics and keyboard navigation. IME composition must never submit a message or close an editor accidentally. Theme changes and navigation must not reset drafts or unsaved profile edits. Reduced-motion mode must retain textual status without shimmering or continuous decorative movement.

## Implementation stages and exit gates

The stages are sequential and independently revertible. Prepare the next stage's ready spec only after reconciling its scope with the previous accepted result and concurrently merged features. An unmerged feature, including local task continuity, is not silently included in this redesign. If it merges first, inventory its affected controls and retain its original behavior/tests in the next implementation spec.

### Stage 1 — UI foundation and a contained pilot

**Deliver:** renderer Tailwind integration, source/license inventory, semantic token adapter, and a pilot covering the existing Language select, Appearance radio choices and New conversation chooser dialog. Keep the appearance choices as one radio group, and keep the chooser's existing Bot/group actions. Its destination editors remain legacy components during this stage. Preserve Settings navigation and field behavior. Do not restyle the conversation yet.

**Exit gate:**

1. A clean desktop build resolves imported source and assets locally. Review the dependency/source inventory against the pinned MIT revision; include dependency notices in the existing packaged-notice mechanism.
2. Extend `e2e/themes.e2e.ts` and `e2e/chat-interaction.e2e.ts` for the migrated Settings controls: light/dark/System persistence, OS changes only under System, unsaved draft retention, readable disabled/error states and keyboard-only operation.
3. Add focused coverage for modal focus, Escape and opener restoration, including a nested modal if the selected pilot can open one. No duplicate focus manager acts on the migrated dialog.
4. Inspect matching before/after Settings and modal captures in both languages and themes. Capture an unmigrated conversation and reader to detect reset/token leakage. Measure normal text, placeholder and action-ink contrast at least 4.5:1; focus and essential control boundaries at least 3:1 against adjacent surfaces.
5. Pass the common implementation checks below. The stage is acceptable as a usable mixed-component application with no broken legacy surface.

### Stage 2 — OpenBot conversation and Bot details

**Deliver:** the mixed conversation list, header, transcript presentation, composer, activity/approval surfaces and Bot details using the foundation. Retain existing avatars and group identity composition. Extract presentational pieces from `App.tsx` as needed without replacing data ownership.

**Exit gate:**

1. Extend `conversation-list`, `conversation-search` and `groups` e2e suites for mixed navigation, Core identity, unread/search behavior, explicit group recipients and private/group draft isolation. Existing group routing and publication assertions remain intact.
2. Extend `chat-interaction`, `chat-streaming`, `runs` and `recovery` suites for IME/Enter/Shift+Enter, attachment/Skills chips, delayed first output, incremental Markdown, follow-up/Stop, queueing, uncertain-send retry with the same request identity, interrupted work and failure recovery. Do not remove identity or no-duplicate-effect assertions to accommodate new markup.
3. Extend `message-activity`, `groups` and approval coverage for working/waiting/approval/error/terminal states. Approvals retain argument evidence, expiry and decision scope, survive restart where already supported, and never appear resolved merely because a panel closes.
4. Extend `files`, `artifacts` and `history-scaling` suites for reader resizing, tab/reading-state retention, details over an open reader, draft retention and scroll anchoring during streaming and history paging. Keep existing bounds on rendered history and reads.
5. Inspect the screenshot matrix below for empty/populated private chat, group chat, working composer, approval, Bot details and chat with reader. Verify no clipped actions or overlapping surfaces, no duplicate live reply and no unexpected scroll jump.
6. Pass the common checks. This stage is accepted only when the complete conversation flow works with existing Host behavior; attractive empty states alone are insufficient.

### Stage 3 — Settings/resources consistency and migration closeout

**Deliver:** remaining settings and resource surfaces, including existing Skills, Connectors, Routines, Library, model/credential, policy, backup, usage and template controls; shared controls in onboarding; deletion of replaced global CSS and temporary migration bridges. Preserve each feature's navigation and confirmation flow. Reader controls may reuse primitives but reader engines remain unchanged.

**Exit gate:**

1. The ready spec inventories remaining controls and identifies which migrated primitive serves each category. No unused BoardUI component or placeholder UI package remains.
2. Existing `skills`, `role-skills`, `connectors`, `routines`, `bot-resources`, `model-sources`, `credentials`, `deterministic-policy`, `backups`, `usage`, `bot-templates`, `desktop-mvp` and locale coverage passes. Extend scenarios only where interactions or accessible semantics changed, including form validation and destructive confirmations.
3. Inspect populated, empty, loading, error and confirmation examples across the migrated surfaces in English/Chinese and light/dark. Check compact forms and long names; no horizontal page overflow except intentional code/table/tab scrolling.
4. Review the final import/license inventory and CSS ownership. Remove obsolete reset/selector bridges, duplicated theme control and redundant icon/font assets introduced during migration. Record baseline and final renderer bundle sizes; investigate unexpected additions and attribute necessary growth to retained components.
5. Pass common checks and the complete screenshot matrix. No owner data migration is needed; a code rollback remains possible without rewriting user data.

## Common implementation verification

Each stage runs `pnpm run check` and a full background `pnpm run e2e` after its final relevant edit, then inspects affected screenshots. The existing package scripts own the checks. Use ScriptedModel and isolated state through the e2e harness; do not run owner-data development commands or substitute owner testing for runnable checks. Refresh shard timings when required by [AGENTS.md](../../AGENTS.md).

Reuse the named suites above; they are existing files under `e2e/`. Add a new suite only for a gap that cannot be clearly expressed there. Prefer observed state and geometry assertions to fixed delays or brittle exact pixel snapshots. Preserve authorization, deduplication, recovery and lifecycle assertions even when DOM selectors change.

| Dimension | Required evidence |
| --- | --- |
| Appearance and language | Matched English/light, English/dark, Chinese/light and Chinese/dark captures for every stage's principal surface |
| Window geometry | Standard 1280 × 800 and compact 900 × 650 captures, plus the existing 880 × 560 minimum BrowserWindow size; record actual viewport dimensions, resize chat/reader split and inspect long labels/filenames |
| Input and overlays | Keyboard-only navigation, visible focus, IME composition, Escape, opener restoration and nested overlays |
| Motion and status | Reduced-motion capture plus checks that loading, waiting and stopping remain understandable without animation |
| Continuity | Draft/profile edits across theme/navigation, reader state across panel changes, approval/recovery across supported relaunch scenarios |
| Isolation | No new BoardUI/asset/font service calls at runtime; preserve existing permitted provider/connector behavior and renderer isolation |

Record candidate revision, commands and outcomes, inspected screenshot paths, source/license review, failures and limitations in each implementation spec or one linked dated acceptance record. Keep private data, logs and temporary images out of Git. Full automated acceptance does not claim native permission, signing, packaged installation or real-provider evidence; those remain separate release gates.

## Risks and rollback

| Risk | Detection and response |
| --- | --- |
| Tailwind/reset or token changes leak into legacy chat/readers | Stage 1 unmigrated-surface captures and contrast checks; fix the style boundary before expanding migration |
| Two focus systems or native reader surfaces conflict with overlays | Nested-dialog and reader/overlay scenarios; assign one focus owner and retain existing native-view visibility coordination |
| UI refactoring changes send, stop or approval semantics | Existing identity/recovery tests plus Stage 2 scenarios; repair the adapter instead of changing Host contracts |
| Source updates overwrite adaptations or introduce restricted files | Pinned revision and import inventory; review each update and reject Pro/unverified additions |
| Concurrent feature work loses controls during a large rewrite | Inventory the merged baseline in every ready implementation spec; migrate small surfaces and retain feature tests |

Rollback is a code revert of the affected stage and its dependent stages where necessary. No data-format migration or persistent UI experiment flag is introduced. Mixed old/new components are a temporary implementation state, not two independently maintained product themes.

## Open questions

- 2026-11-02: The exact free revision and minimal dependency closure must be fixed in the Stage 1 ready implementation spec. This does not reopen the selected free-only direction or authorize installing the full catalogue.
- 2026-11-02: Electron integration, overlay interoperability and performance have not been demonstrated. Stage 1 establishes this evidence before the conversation migration proceeds; any required protocol or persistence change returns to design.

## Design evidence

The design review examined the current renderer package/build configuration, theme tokens, appearance preference, conversation/composer ownership, dialog focus management, resizable reader layout and relevant e2e contracts. Existing isolated screenshots were inspected during the initial assessment; they are historical visual evidence, not a fresh run against this design baseline. Official BoardUI installation, source, MIT and Pro license documentation was checked on 2026-11-02.

This deliverable changes documentation only. Implementation and runtime acceptance remain unexecuted. Documentation validation checks local references, task-index navigation and `git diff --check`; product suites are not required for this design draft.

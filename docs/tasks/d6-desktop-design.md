# D6: Desktop Visual and Interaction Design

Status: draft for owner review; design study complete, product implementation not started
Branch: task/d6-desktop-design
Date: 2026-10-22
Depends on: B20, B21, B22, B23, B15a
Architecture: Sections 1, 1.1 and 3; existing Desktop/Host/Executor boundaries remain unchanged

## Goal

Make OpenBot feel like a considered personal Mac application: recognize the right Bot, read its answer comfortably, inspect its deliverable, and understand exactly when an action needs a decision. The daily surface should emphasize conversation and results; configuration and execution details should be available without competing with them.

This is a design task, not authorization to implement a new runtime feature. It includes a source-informed audit, a local interactive prototype, and the contracts and acceptance matrix for subsequent implementation packets. Product source, policy, data stores, and the owner's running app are unchanged.

## Evidence and current diagnosis

Inspected renderer source in the owner's checkout at `fc37cec` on 2026-10-22. This design branch starts from the existing `origin/main`; the extra role-skills specification in the owner's branch is not part of this change. Evidence consists of code, the committed real-model report screenshot, and existing isolated e2e screenshots. Historical screenshots are not presented as newly captured production behavior. No private user conversations or credentials were inspected.

| Evidence | Observation | Consequence |
| --- | --- | --- |
| `apps/desktop/src/renderer/src/styles.css`, `conversation.css`, `main.tsx` | Both stylesheets define root colors and app geometry; conversation styles override the base system. Several supporting labels are 10–11 px. | The product has overlapping visual systems. New local fixes will continue to drift without a single token source. |
| `docs/images/openbot-weekly-report.png` | Two result cards, publication notices, repeated actions and answer compete in one reading sequence. Each card prominently presents Preview, Export and Remove. | The user scans operational UI before finding the conclusion and deliverable. |
| Existing `e2e/.run/conversation-experience/01-group-light-en.png` | Large filled assistant bubbles, compact metadata, a full-width task block and several sidebar sections coexist. | Too many similarly weighted containers; a long answer looks like a large grey slab. |
| Existing `e2e/.run/conversation-experience/02-details-en.png` | Details sit beside the conversation, but membership, explanatory copy and destructive controls have similar emphasis. | Keep the contextual panel; reorganize its contents and action hierarchy. |
| `App.tsx`, `Settings()` | Jump buttons scroll a long surface containing default model, credentials, setup, language, search, grants, configuration and data. | Finding an infrequent preference requires scanning unrelated sections. |
| `ApprovalCard.tsx`, `AlwaysAllow.tsx` | The approval component has bounded choices, exact arguments, expiry and separate reusable grant controls. | Improve comprehension without weakening or obscuring those contracts. |
| `ConversationUI.tsx`, `ChatComposer.tsx`, B21–B23 | Drafts, send recovery, scroll preservation, details, search and read behavior already exist. | Preserve these working mechanisms; they are not missing features to rebuild. |

The old `e2e/.run/01-settings.png` was also inspected, but its older sidebar and form layout do not establish current styling. The current settings diagnosis above comes from source.

## Recommended visual direction

**A quiet personal workspace with recognizable teammates and readable deliverables.** The app is used for sustained reading, so the visual character comes from disciplined type, a blue-grey navigation surface, compact identity marks and a consistent result card. It does not need a dashboard, hero artwork or decorative analytics.

Three layouts were considered:

```text
A. Messaging + contextual inspector (recommended)
   [ Bot roster ][ conversation and composer ][ inspector when opened ]

B. Permanent three-column operations console
   [ navigation ][ conversation ][ all tasks, files and controls ]

C. Full-width single chat
   [ roster hidden ][ conversation ][ details in dialogs ]
```

A keeps the existing Bot mental model and makes outputs accessible. B continuously narrows the reading area and repeats task state. C makes switching persistent teammates unnecessarily indirect. At small desktop widths, A's inspector overlays the conversation rather than reducing its useful width.

The signature is the **deliverable card paired with a quiet execution receipt**. A file reads as something the Bot produced, while the receipt explains how the work was done. This is a visual pattern, not a new artifact type or new proof of completion. No synthetic thumbnails of file contents, invented source counts, progress percentages or completion claims may be inferred from model prose.

An early direction with a permanent activity strip and decorative team avatars was discarded before building: both repeated information already present in messages. The prototype spends emphasis on one result and one decision at a time.

### Design tokens

| Role | Light | Dark | Use |
| --- | --- | --- | --- |
| Canvas | `#FFFFFF` | `#19212E` | Conversation and primary content |
| Navigation | `#EDF1F6` | `#141C28` | Bot roster and app navigation |
| Surface | `#F5F7FA` | `#202B3A` | User message, quiet form regions |
| Ink | `#202B3D` | `#E7EDF7` | Primary reading text |
| Secondary ink | `#5f6c80` | `#A5B2C6` | Supporting text |
| Accent | `#315FD4` | `#A9C1FF` | Focus, selected controls, links |

Supporting semantic tokens: light border `#DCE3ED`, selection `#E0E8FA`, success `#286A56`, attention `#865917` on `#FFF8EB`. Dark border `#344255`, selection `#2A3C5B`, success `#9ED2BB`, attention `#EFD398` on `#322E24`. Dark solid primary buttons use `#3F6ED8` with white text. Validate every actual text/background pairing; a decorative border is not an adequate control boundary or focus indicator by itself.

- **Type:** system SF/Helvetica stack for controls and body; Avenir Next used sparingly for the OpenBot wordmark and document-style headings, with system fallbacks; SF Mono/Menlo for commands and paths. No remote font requests.
- **Scale:** body 15 px, line-height 1.65–1.75; navigation and controls 13–14 px; secondary text 12 px; conversation heading 16 px; result heading 20–22 px. Prototype timestamps and nonessential shortcut hints are smaller; no decision, error or scope description may rely on those sizes. Chinese uses the system CJK fallback and needs its own line-height verification.
- **Geometry:** 244 px roster; conversation reading width at most 700–760 px; 340 px inspector; 8 px spacing rhythm with 4 px fine adjustments. 8–10 px controls, 12 px result cards, 15 px composer. No universal oversized rounding.
- **Icons:** one consistent 18 px outline family with accessible names; 32–36 px minimum desktop hit targets. Use recognizable identity color sparingly. Core remains visibly distinct and protected.
- **Motion:** 120–160 ms for direct state feedback and panel entry; no ambient animation. Honor reduced motion. No simulated typing, waiting or progress.

## Interaction design and preservation contracts

### Navigation and identity

Keep Core, pinned Bots, other Bots and groups within their existing ordering rules. Rows share avatar, name, one preview line, time and optional unread/attention marker. Preserve current draft/activity/latest-message precedence and native-aware read semantics. Never use only color to distinguish an approval, failure or unread state. Keep search and New accessible; reduce heading weight, not discoverability.

Keep Routines, Connect apps, Skills and Settings in the bottom navigation. The existing global Pause/Resume control remains visible and keyboard-accessible when work can be affected. The study's idle footer is not a replacement for this control. A local readiness label must reflect actual Host state and must not imply that inference is offline.

Do not remove All/Unread filtering, hidden Bots, pinned ordering or mark-read just because they are absent from the reduced demo fixture. No new navigation data model is needed.

### Conversation and composition

- Use restrained user bubbles and unboxed, well-spaced Bot content. Retain the actual author identity for every group contribution, including when messages are adjacent.
- Keep chronological message order. Make delivered artifacts easier to find in their existing publication positions first. Never move an approval, failure or interrupted tool receipt below later successful content.
- The prototype shows one composed result example. Production must not generate a heading such as “Your report is ready” independently of actual message content or committed receipts.
- Preserve Markdown, selectable text, code wrapping/scrolling, links and table readability. Add no automatic page-level horizontal scrolling for wide code or tables.
- Keep one composer with clear Send versus Stop states, visible pending messages and existing steering behavior. Retain attachments, skill selection, IME handling, recipient IDs, draft recovery and per-channel persistence.
- Opening or closing an inspector must preserve the draft and reading anchor. Incoming content cannot drag a reader away from older messages. Keep Jump to latest.
- Use contextual inline errors with the existing recovery action. Toasts are for brief confirmations, never the only location for a failed send, expired approval, paused Run or unavailable artifact.

### Execution and attention

| Actual state | Presentation | Required action |
| --- | --- | --- |
| Queued | Compact labelled status near composer | Existing cancel/stop semantics |
| Working | Current activity and Stop; details expandable | Stop remains reachable without opening the inspector |
| Approval needed | Expanded decision card in transcript; compact composer reminder | Review exact operation, Deny or Allow once |
| Paused / interrupted | Persistent explanation of the actual state | Explicit continuation or recovery when supported |
| Failed | Inline error beside affected work | Existing bounded retry; no automatic side-effect replay |
| Completed | Readable answer and actual outputs; collapsed execution details | Preview/export result or inspect receipt |
| Unknown outcome | Explicit “Outcome unknown” and reconciliation context | Never relabel as completed or offer an unsafe retry |

Use existing Run, task and tool records to render these states. Do not create a new independent client status machine. The existing group task chain and usage/evidence links remain reachable. A compact receipt cannot collapse pending approvals, failures, unknown outcomes or incomplete cancellation.

### Approval

Show the action, Bot, bound target, exact arguments and meaningful scope before the decision controls. Known structured operations may have a readable summary; the authoritative parameters must remain inspectable. A shell command's working folder must never be described as a sandbox or exclusive file-access boundary.

Keep Deny and Allow once visible and unambiguous. Always allow is a separate disclosure leading to the existing exact scope preview and explicit confirmation. Preserve Ask first precedence, shared grants, target binding, expiry, pending/disabled states, stale revisions, credentials redaction and unsupported reusable scopes. Do not add a universal Always allow action to operations that do not support it. A UI click is pending until the Host confirms the decision.

### Artifacts and inspector

Make Preview the main affordance. Keep Export copy available; put Remove local copy in a clearly labelled secondary menu with its current confirmation. Do not remove supported actions to obtain a cleaner screenshot.

The proposed common inspector has exactly one active content type: Bot/group details or a supported artifact preview. Opening another type replaces the visible content; it does not create a fourth column. Metadata uses existing artifact names, sizes, availability and identity, not guessed document titles. A generic document icon is acceptable; a miniature rendering requires actual validated preview content.

At wide widths the inspector is nonmodal and independently scrollable. At narrower widths it becomes a modal drawer with scrim, inert background, focus containment, Escape dismissal and return focus. Breakpoint is based on preserving at least approximately 560 px for conversation content; 1180–1200 px is the initial desktop target. Reuse and extend the existing `DetailsPanel` focus behavior rather than replacing it with raw overlay markup.

Preserve B15a validation, supported preview formats, content bounds, missing/removed states, sanitization, export identity and revoke/removal refresh. Opening an artifact cannot implicitly read arbitrary local paths or execute HTML. The prototype's report is a fixture, not an implemented artifact renderer.

### Settings information architecture

Replace jump links with category navigation and one content surface. Preserve every existing setting and its save/test semantics.

| Category | Existing functions to retain |
| --- | --- |
| General | Language; any existing application-level lifecycle/notification preferences, without inventing new toggles |
| Models | Default model; built-in/custom model setup; credential add/remove; test connection; models.json reload and errors |
| Web search | Existing provider/key/configuration controls and disclosures |
| Permissions | Ask first, automatic command rules and folder grants; existing targeted guidance and controls |
| Activity | Existing management history and relevant evidence navigation |
| Data & storage | Data/workspace locations, credential storage health and migration controls, current privacy explanation |

Routines, Connect apps and Skills remain their own top-level destinations. Usage stays in its existing contextual location. Do not silently move it into a newly invented global billing system.

In Models, distinguish configured, testing, connected-after-test and failed. A stored API key alone does not prove a connection works. Keep provider disclosures near the relevant controls. Never persist credentials in drafts or new UI storage. Category changes preserve unsaved non-secret input or make the existing discard/save decision explicit; secret input keeps its current security lifecycle. The prototype implements four illustrative categories, not the full migration inventory.

### Empty states and first use

Give Core a simple first-task invitation and show two or three concrete examples. Model setup or its existing skip path remains available. Specialists are never seeded by the redesign; the demo roster is synthetic. Explain missing configuration where it prevents sending, without blocking the user from managing Bots. Preserve first-launch, no-search-results, missing-file, disconnected-Host and no-unread states as distinct cases.

## Deliverables and demo limits

- [Interactive prototype](../design/d6/prototype.html): conversation, report/data inspector, approval decision, settings categories, empty conversations, per-Bot in-memory drafts, search filter and light/dark appearance.
- [Prototype checks](../design/d6/verify.js): reproducible browser checks of the local study.
- [Verification record](../design/d6/README.md): how to preview, what was exercised, and limits.

All demo content is fictional and labelled as such. Sending only adds a local message. Approval buttons do not run commands or save grants. Unimplemented peripheral controls show a specific demo explanation instead of pretending to work. Reloading resets the study. It intentionally does not reproduce native titlebar traffic lights, live streaming, durable drafts, production modal behavior or all translated states. Prototype HTML is review material, not product code to copy into React.

## Proposed implementation packets

Each packet requires its own ready execution spec, branch and PR after direction is settled. This task does not silently reprioritize the established delivery queue.

1. **Visual foundation and conversation:** consolidate tokens, remove conflicting root overrides, standardize icons/control variants, style the existing roster, transcript and composer without changing message order or actions. Touch renderer styles and components only. Highest immediate visual value and lowest data risk.
2. **Results, approvals and inspector:** apply the new artifact/action hierarchy and shared panel behavior; preserve all permission and artifact state contracts. Any new presentation grouping must be keyed to existing durable identities and have its own explicit contract.
3. **Settings and remaining surfaces:** category navigation with a complete old-to-new control inventory; align onboarding, creation, groups, skills, connectors and routines with the component system. Preserve drafts, secret handling and save conflicts.

No new UI framework, remote fonts, Pi changes, Host APIs, schema migrations or navigation store are required merely to implement the visual foundation. Prefer focused reusable components (button variants, row, panel header, field, state notice) over a broad UI-library rewrite. Split `App.tsx` only where the packet's view/component responsibility warrants it.

## Acceptance for later execution

These are required implementation checks, not claims that the prototype proves production behavior.

| Scenario | Automated proof |
| --- | --- |
| Direct conversation, rich answer, artifact, code/table, long name | ScriptedModel e2e at 1280×820 and minimum 880 px width; inspect screenshots and overflow assertions |
| Light/dark, English/Chinese, reduced motion, 200% zoom | Screenshot/keyboard matrix; no clipped decisions or inaccessible composer; contrast checks on actual tokens |
| Draft, IME, pending send, send failure, channel switch | Existing B21 coverage plus panel/category-switch regression scenarios |
| Reading old history during incoming activity | Scroll anchor and Jump to latest e2e; no forced scroll from panel changes |
| Core, pinned, unread, hidden Bots and search | B22/B23 semantics and exact-message jump survive new row layout |
| Group routing and work | Scripted Core/default and explicit-mention scenarios; actual author and attention state retained; Stop still visible |
| Pending, expired, stale and reusable approval | Scripted exact-operation approval, Deny, Allow once, supported Always allow scope and timeout; no action before Host confirmation |
| Result preview/export/remove/missing | Existing B15a bounds and validation; panel focus/scroll; removal updates every linked card |
| Settings categories | Every control in the inventory reachable by keyboard; no lost unsaved input; custom/built-in model setup and errors exercised |
| Host disconnected, queued, paused, cancelled, interrupted, unknown | Persistent truthful states and existing recovery behavior, including global Pause/Resume |
| Complete regression gate | `pnpm run check`, `pnpm run e2e`; inspect `e2e/.run/` screenshots; isolated background agent-browser exploration for new or failed flows |

Avoid pixel snapshots as the only proof. Assert meaningful visibility, focus, retained values and action outcomes. Do not write tests merely mirroring class names. Native titlebar, packaged permissions and signing remain separate packaged Mac checks.

## Risks

- Over-cleaning can hide consequential state. Preserve expanded decision/error states and inventory every existing control.
- Reordering cards can misrepresent chronology. The first packet only changes presentation; later grouping needs an explicit durable relationship.
- A new inspector can disrupt reading or focus. Extend current focus/anchor rules and test wide and overlay modes.
- CSS overrides can conceal regressions. Migrate to one token source instead of appending another override stylesheet.
- The study's sparse example can understate density. Execute long transcripts, multiple artifacts, long Chinese names and multiple pending work states before acceptance.

## Open questions

- 2026-10-22: Owner review of the proposed visual direction and its relative priority against the existing delivery queue remains open. The interactive study is concrete enough to review; this does not block further design refinement.
- 2026-10-22: Choose the first execution packet in its own ready spec. No product implementation has been claimed or started by D6.

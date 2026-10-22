# D6: A Personal Assistant with Character

Status: design direction agreed; execution specs pending, product implementation not started
Branch: task/d6-desktop-design
Date: 2026-10-22
Depends on: B20, B21, B22, B23, B15a
Architecture: Sections 1, 1.1 and 3; existing Desktop/Host/Executor boundaries remain unchanged

## Goal

Give OpenBot the character of a warm, intelligent personal assistant whose primary interface is conversation. A recognizable assistant, continuity with the user's own work, and visible, correctable memory should make the application feel personal. The assistant should be easy to talk to while remaining precise about what it has done and what still needs permission.

Owner preference: a private assistant with personality, warmth and approachability; chat is the core experience. The permanent personal assistant appears as an ordinary chat with a small dedicated star, not as a visually elevated Core role. It cannot be deleted. Every Bot, including the permanent assistant, has an editable name, avatar, role and instructions. The design expresses that through identity, language and interaction, with focused Specialists available as supporting teammates.

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

**A familiar assistant, with room to think.** A dark plum navigation frame surrounds a soft lilac conversation canvas. The personal assistant has an original, simple vector avatar: a rounded figure, an attentive expression and a small leaf-shaped accent. The avatar uses the same roster geometry as other Bots. It may appear at welcome scale only in an explicit empty-state study, then becomes a small author avatar during conversation. It is a static identity mark, not a pet, fabricated emotional state, presence signal or claim of consciousness.

The normal entry is the conversation, framed by a unified chat list. The explicit welcome/empty-state study uses an asymmetric greeting and character above a generous composer. The conversation remains spacious and direct. A pale olive inset can distinguish a short plan within an actual response; warm paper-colored file icons make outputs feel like useful things the assistant prepared for the user.

```text
[ Chats: OpenBot ★, other Bots, groups ] [ Familiar greeting       Character ]
                                        [ One inviting composer             ]
                                        [ Resume conversation | Bot memory  ]

[ Same ordinary chat list              ] [ Human request                     ]
                                        [ Natural reply + useful next step  ]
                                        [ File, when produced               ]
                                        [ Composer                          ]
```

The main signature is the **familiar chat identities and conversational continuity**. The assistant's avatar remains consistent across conversation, profile and approvals. A small star beside its name identifies the permanent personal assistant without a separate section, larger card, privileged row height or Core label. Files and execution records support the conversation; they do not become the product's identity.

### Visual tokens

| Role | Light | Dark | Use |
| --- | --- | --- | --- |
| Frame | `#242131` | `#242131` | Navigation and window surround |
| Frame ink / secondary | `#F3EFFA` / `#B9B3CA` | Same | Accessible navigation text |
| Canvas | `#FAF9FD` | `#2C2739` | Main conversation surface |
| Paper | `#FFFFFF` | `#342E43` | Composer, files and preview |
| Ink | `#30283F` | `#F1EAF9` | Reading text |
| Secondary | `#756C83` | `#C0B5CE` | Supporting text |
| Accent | `#644689` | `#75509C` | Send and primary decision |
| Accent text | `#695093` | `#D0B4F0` | Greeting and contextual links |
| Lavender | `#E8DFF5` | `#514164` | Identity and soft emphasis |
| Warm paper | `#F5E7D7` | `#4A3C38` | File icon surface |

Supporting colors: light border `#E5DFED`, user message `#EEE7F6`, success `#47735C`, attention `#865A27` on `#FCF4E6`. The character uses a lavender body and a small `#E3E9B6` leaf accent. Its color is decorative and never encodes an authorization state. Dark mode retains sufficient contrast for essential labels and buttons.

- **Type:** Avenir Next, with system fallbacks, for conversational headings and identity; system SF/Helvetica stack for reading and controls; SF Mono/Menlo for exact commands and paths. No remote font loading. CJK uses the system fallback and requires separate implementation verification.
- **Scale:** welcome heading 39–48 px on wide desktops, 30–35 px in constrained layouts; conversation headings 23–25 px; body 15 px / 1.75; controls 13–14 px; secondary information 11–12 px. Never render a scope, decision or error only as tiny metadata.
- **Geometry:** 232 px navigation, 810 px maximum welcome content, 685 px reading column, 330 px preview. Rounded 22 px main surface inside the dark frame; 19–21 px composer; 12 px files. This framing is a prototype treatment; implementation must account for native titlebar and traffic-light hit areas.
- **Motion:** short direct hover/panel feedback only, disabled for reduced motion. The character remains still during work and approvals; no idle breathing, blinking, pretend listening, fake typing or artificial completion sequence.
- **Assets:** the character is original inline SVG authored for this study. No generated stock illustration, remote image, copied mascot or new runtime dependency is required.

### Voice and personal continuity

| Moment | Tone and behavior | Example from the fictional fixture |
| --- | --- | --- |
| Welcome | Invite an incomplete thought without demanding a perfect task brief | “What's on your mind?” |
| Help | Offer a grounded next step and explain its basis | “From your notes, the proposal is the one thing to protect.” |
| Memory | State what is actually stored and make correction easy | “Keep the plan simple. Leave some room to breathe.” with View & edit |
| Approval | Calm, clear and specific; no reassuring claim about unknown effects | “Take a look at the command below and decide whether you want me to continue.” |
| Error | Explain what happened and the next available action | Existing truthful error and recovery states, styled consistently |

Avoid repetitive diminutives, canned encouragement, pet names, emotional dependency language or claims that the assistant knows how the user feels. Warmth comes from attending to the user's actual request and remembering explicit preferences accurately. Do not automatically add personal-sounding sentences to model output in the renderer.

The welcome study is a reviewable entry/empty-state concept. Existing conversations must reopen at their saved reading position, not be replaced every time by a greeting. Returning to a Bot remains a direct route to its conversation. A greeting/overview is only shown on an explicitly specified entry or empty state. The execution spec must fix that entry behavior before implementation.

The resume row reads existing conversation metadata and opens its actual conversation; it is not a new task database. A memory excerpt comes only from the selected Bot's existing memory, is clearly identified as memory, and opens the current revision-aware editor. There is no new shared-memory layer, personal profiling service or invented preference. Empty memory hides the excerpt or offers the existing memory explanation. A deleted or changed memory must stop appearing in this surface. The fixture's single excerpt is not a proposed ranking algorithm: selection/truncation rules must be explicit in the execution spec.

## Interaction design and preservation contracts

### Navigation and identity

Use one ordinary chat-list presentation for Bots and groups, preserving existing protected Core-first placement, pinned ordering and recency rules internally. All rows use the same avatar box, height, padding, name, one message preview and optional timestamp/unread/attention state. Groups retain their recognizable group avatar and member context. There is no dedicated Core section or “Your assistant” card.

The permanent personal assistant has a small, static five-point star beside its name in the roster and active conversation header. Its accessible label and hover text identify the personal assistant. It is not a clickable favorite, user pin, unread marker, rank, permission status or proof of greater capability. User pin/unread markers must remain visually and semantically distinct. Customizing the name or avatar does not remove this marker or affect protection: production derives it from the immutable Bot identity/kind, never a display name.

The ordinary chat UI uses the Bot's display name. “Core” remains an internal design/protocol term; group recipient explanations refer to the actual default recipient's display name. Profile details may briefly explain that the built-in personal assistant cannot be deleted or hidden. Its actions omit Delete/Hide; other Bots retain their existing lifecycle controls and confirmations. Host enforcement remains authoritative, including after renaming, through management tools, or with forged requests. The visual marker grants no authority and cannot change a grant.

Preserve current draft/activity/latest-message precedence, hidden-Bot access, unread filters and native-aware read semantics. Never use only color to distinguish approval, failure or unread state. Keep Search and New accessible. The fixture's one list does not authorize a new sorting model or storage migration.

Keep Routines, Connect apps, Skills and Settings in the bottom navigation. The existing global Pause/Resume control remains visible and keyboard-accessible when work can be affected. The study's idle footer is not a replacement for this control. A local readiness label must reflect actual Host state and must not imply that inference is offline.

Do not remove All/Unread filtering, hidden Bots, pinned ordering or mark-read just because they are absent from the reduced demo fixture. No new navigation data model is needed.

### Editable profiles and generated avatars

[Grok Bot's official Bots documentation](https://docs.x.ai/grok-bot/bots), reviewed 2026-10-22, exposes name, label, description and avatar through Edit Profile. It does not document an automatic avatar-generation algorithm. OpenBot adopts the unified editing concept; the local character generator below is an original proposal, not a claim about Grok's implementation.

Every Bot, including Core, exposes the same Edit profile action. Name, avatar, role and working instructions are editable. Save updates the roster, header and author identity together; Cancel leaves the saved profile unchanged. Display names may collide without changing Bot identity, message ownership, memory, grants or lifecycle protection. The Core star stays outside the avatar so that a custom image cannot hide the permanent-assistant marker. Group avatars and membership remain a separate group-editing concern.

Proposed avatar choices:

1. **Automatic local character.** Creating a Bot assigns an original procedural avatar from a stable seed and renderer version. Combine a small family of rounded silhouettes, facial details, restrained palettes and optional role motifs. Research can suggest glasses and writing a cap; role cues are a starting point, not a required identity. Use the immutable Bot ID and an explicit variation seed, not the display name, to maintain stability. Evaluate recognition at 24–40 px and avoid palette-only differences between adjacent Bots.
2. **Choose another.** Generate six candidates locally, with Another set and a selected preview. Save applies the choice; changing name, role or instructions alone never regenerates an existing avatar. Store the selected recipe/version or a normalized rendered asset so a later generator update does not silently change familiar faces.
3. **Upload an image.** Let the owner choose a local PNG, JPEG or WebP, preview its square crop, and save explicitly. A production editor should support crop adjustment. The prototype only demonstrates a centered crop, a 5 MB limit, a dimension check after decoding and 256 px PNG normalization; this is not hardened production import validation.

AI image generation is a later, optional explicit action for an owner who wants a specific style or character. It needs an image-capable provider, a clear account of the prompt/data sent and any provider cost, candidate preview and explicit selection. It must not block Bot creation, run silently on rename or be implied by the local Generate options control. There are no image-provider calls in this study.

Current product evidence: `BotProfile` in `packages/protocol/src/index.ts` has no avatar field. The renderer's `Avatar` in `App.tsx` derives Specialist color from the name and uses initials; Core has a fixed mark. Persisted custom avatars therefore need their own ready execution spec covering profile serialization, versioning, revision conflicts, normalized local asset references, import validation before expensive decoding, asset size/pixel bounds, cleanup/backup and duplicate behavior. Raw uploaded SVG, arbitrary local paths and remote URLs are not accepted avatar sources. Preserve the existing Host/Executor boundary for local import and storage. Duplicating a profile can copy its appearance, but creates a new Specialist identity without the Core star or protection.

The study implements the editor and candidate picker for all three fixture Bots, including selected-file decoding in the browser. It does not implement the real Create Bot flow, persistent storage, arbitrary crop positioning or AI generation. No selected image leaves the page; all edits reset on reload.

### Conversation and composition

- Use restrained user bubbles and unboxed, well-spaced Bot content. Retain the actual author identity for every group contribution, including when messages are adjacent.
- Keep chronological message order. Make delivered artifacts easier to find in their existing publication positions first. Never move an approval, failure or interrupted tool receipt below later successful content.
- The prototype shows one composed conversation example. Production must not invent empathetic commentary, result headings, personal preferences or completion claims independently of actual model messages and committed receipts.
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

The file inspector shows one supported artifact at a time. Bot/group profile and memory editing use a focused dialog in the study, with one active editor and explicit close/save behavior. These surfaces must not create a fourth column or leave hidden editors accepting keyboard input. Metadata uses existing artifact names, sizes, availability and identity, not guessed document titles. A generic document icon is acceptable; a miniature rendering requires actual validated preview content.

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

Give an empty personal-assistant conversation a recognizable avatar and a simple first-task invitation with two or three concrete examples. Use a first-meeting greeting when there is no prior conversation, and a returning greeting only where existing history justifies it. Model setup or its existing skip path remains available. Specialists are never seeded by the redesign; the demo roster is synthetic. Explain missing configuration where it prevents sending, without blocking the user from managing Bots. Preserve first-launch, no-search-results, missing-file, disconnected-Host and no-unread states as distinct cases.

## Deliverables and demo limits

- [Interactive prototype](../design/d6/prototype.html), with [styles](../design/d6/personal.css) and [interaction code](../design/d6/personal.js) and [local avatar generator](../design/d6/avatars.js): editable names/roles/avatars, local image preview, welcome, conversation, plan preview, approval, memory editing, assistant profile, search, settings and light/dark appearance.
- [Prototype checks](../design/d6/verify.js) and [profile/avatar checks](../design/d6/verify-avatars.js): reproducible browser checks of the local study.
- [Verification record](../design/d6/README.md): preview instructions, checks and limits.

All fixture content is fictional and labelled. Sending adds an in-memory preview message and never calls a model. Approval controls never execute or save a grant. Memory/profile edits affect only page state and reset on reload. Peripheral controls explain their demo limits. The plan is based on a fictional supplied notes file; it is not a calendar integration. No event, email or external record is changed.

The welcome character, memory excerpt and resume action are design proposals. No automatic proactive outreach, routine creation or background summarization is authorized by this design. The current product's privacy, identity, permission and credential contracts remain unchanged. English is the prototype language; both existing product languages remain implementation acceptance requirements.

## Proposed implementation packets

Each packet requires its own ready execution spec, branch and PR after direction is settled. This task does not silently reprioritize the established delivery queue.

1. **Personal identity and conversation:** settle entry behavior, consolidate tokens, remove conflicting root overrides, standardize icons/control variants, apply the original assistant identity and warm visual system to the existing roster, transcript and composer without changing message order or actions. Specify how the welcome/resume/memory surfaces use existing records before implementing them. Touch renderer styles and components only. Highest immediate visual value and lowest data risk.
2. **Context, results, approvals and inspector:** apply the new artifact/action hierarchy and consistent file-panel and profile-dialog behavior; preserve all permission and artifact state contracts. Any new presentation grouping must be keyed to existing durable identities and have its own explicit contract.
3. **Persisted profiles and avatars:** specify stable generated recipes/versioning, normalized uploaded assets, profile revisions and storage lifecycle; support customization for every Bot while retaining Core identity and lifecycle protection. This requires protocol and persistence work beyond the renderer-only foundation. Optional AI generation needs a separate provider/design decision.
4. **Settings and remaining surfaces:** category navigation with a complete old-to-new control inventory; align onboarding, creation, groups, skills, connectors and routines with the component system. Preserve drafts, secret handling and save conflicts.

No new UI framework, remote fonts, Pi changes, Host APIs, schema migrations or navigation store are required merely to implement the visual foundation. Prefer focused reusable components (button variants, row, panel header, field, state notice) over a broad UI-library rewrite. Split `App.tsx` only where the packet's view/component responsibility warrants it.

## Acceptance for later execution

These are required implementation checks, not claims that the prototype proves production behavior.

| Scenario | Automated proof |
| --- | --- |
| Welcome/return entry, direct conversation, rich answer, artifact, code/table, long name | ScriptedModel e2e at 1280×820 and minimum 880 px width; inspect screenshots and overflow assertions |
| Light/dark, English/Chinese, reduced motion, 200% zoom | Screenshot/keyboard matrix; no clipped decisions or inaccessible composer; contrast checks on actual tokens |
| Draft, IME, pending send, send failure, channel switch | Existing B21 coverage plus panel/category-switch regression scenarios |
| Reading old history during incoming activity | Scroll anchor and Jump to latest e2e; no forced scroll from panel changes |
| Ordinary chat rows, permanent assistant star, pinned/unread/hidden Bots, group distinction and search | B22/B23 semantics survive; star stays bound to immutable Core identity after renaming; Core cannot be deleted or hidden through UI or Host/tool entry points; Specialists retain confirmed lifecycle actions |
| Editable profiles and avatars | Rename/role edits preserve selected avatar, history, draft and memory; safe long/duplicate names; every surface updates after save/restart; Cancel and revision conflicts preserve saved data; generated variants, malformed/oversized uploads, crop, missing assets, duplication, cleanup and backup covered by the ready persistence spec |
| Group routing and work | Scripted Core/default and explicit-mention scenarios; actual author and attention state retained; Stop still visible |
| Pending, expired, stale and reusable approval | Scripted exact-operation approval, Deny, Allow once, supported Always allow scope and timeout; no action before Host confirmation |
| Result preview/export/remove/missing | Existing B15a bounds and validation; panel focus/scroll; removal updates every linked card |
| Settings categories | Every control in the inventory reachable by keyboard; no lost unsaved input; custom/built-in model setup and errors exercised |
| Host disconnected, queued, paused, cancelled, interrupted, unknown | Persistent truthful states and existing recovery behavior, including global Pause/Resume |
| Complete regression gate | `pnpm run check`, `pnpm run e2e`; inspect `e2e/.run/` screenshots; isolated background agent-browser exploration for new or failed flows |

Avoid pixel snapshots as the only proof. Assert meaningful visibility, focus, retained values and action outcomes. Do not write tests merely mirroring class names. Native titlebar, packaged permissions and signing remain separate packaged Mac checks.

## Risks

- Personalization can imply more knowledge than exists. Display only the selected Bot's stored memory and actual history; keep correction and deletion effective.
- A welcome concept can interrupt daily work. Preserve direct conversation return and scroll/draft state; entry behavior needs a ready execution contract.
- A character can become distracting. Restrict it to identity and welcome scale; never animate it as fake activity or make it the only state indicator.

- Over-cleaning can hide consequential state. Preserve expanded decision/error states and inventory every existing control.
- Reordering cards can misrepresent chronology. The first packet only changes presentation; later grouping needs an explicit durable relationship.
- A new inspector can disrupt reading or focus. Extend current focus/anchor rules and test wide and overlay modes.
- CSS overrides can conceal regressions. Migrate to one token source instead of appending another override stylesheet.
- The study's sparse example can understate density. Execute long transcripts, multiple artifacts, long Chinese names and multiple pending work states before acceptance.

## Open questions

- 2026-10-22: The selected direction is a warm personal assistant in an ordinary chat list, with a static identity star and protected lifecycle. Memory excerpt selection/truncation and its exact empty-state placement must be fixed in the relevant execution spec.
- 2026-10-22: Every Bot is customizable. Persisted avatar recipes/assets and import contracts need a ready execution spec; optional AI image generation is not included in the local generator proposal.
- 2026-10-22: Choose the first execution packet in its own ready spec. No product implementation has been claimed or started by D6.

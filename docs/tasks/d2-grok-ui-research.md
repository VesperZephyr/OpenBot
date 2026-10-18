# D2: Grok Bot Interaction Research

Status: research complete; proposed implementation in [B21](b21-conversation-experience.md)
Reviewed: 2026-10-17

## Finding

OpenBot should feel like a small messaging application for persistent teammates. The main improvement is consistent navigation, reliable composition and understandable activity. Changing colors alone will not resolve the current separation between private chats, group tasks and management forms.

## Evidence and limits

Three sources were compared: the owner's supplied screenshot, official documentation, and read-only inspection of the installed Grok Bot 0.71.2 application archive. The installed package identifies an Electron main entry, React, Base UI, Lingui, StyleX and Tiptap dependencies. Selected compiled renderer modules confirm component behavior described below. Dependency declarations alone do not prove every library is used on every screen.

This was static client inspection, not a new live interaction session with the owner's Grok account. No account database, credentials or private conversation files were inspected. No proprietary source, artwork or extracted application files are included in OpenBot. A bundled client cannot establish server implementation, scheduling guarantees or behavior behind rollout flags. The screenshot and installed release may show different product variants.

Official references:

- [Chat and collaboration](https://docs.x.ai/grok-bot/chat-and-collaboration): sidebar entry, structured mentions, messages during work, group handoffs and keyboard navigation. It also documents that approval requests are absent from group transcripts; OpenBot deliberately keeps its existing scoped approvals visible in groups.
- [Bot management](https://docs.x.ai/grok-bot/bots): short creation flow, profile editing, pin/hide, duplication and durable roles. This supports separating occasional configuration from daily conversation.
- [Settings and notifications](https://docs.x.ai/grok-bot/settings-and-notifications): app settings versus conversation details, attention/unread/working states, and contextual error presentation. Grok's managed model selection does not fit OpenBot's configurable model requirement.
- [Files and results](https://docs.x.ai/grok-bot/files-and-results): artifacts belong near the result and can open a preview. This is a later OpenBot increment; it does not justify adding nonfunctional attachment controls now.
- [Approvals and privacy](https://docs.x.ai/grok-bot/approvals-security-and-privacy): review target and inputs before approval. OpenBot retains its own Host-enforced policy and local execution model.

### Reproducible client evidence

Archive: `/Applications/Grok Bot.app/Contents/Resources/app.asar`. Paths below are relative to that archive. Hashes identify the inspected build, not an upstream source revision.

| File | SHA-256 prefix | Confirmed observation |
| --- | --- | --- |
| `package.json` | `4a990be80cf0aee5` | Version 0.71.2; Electron main entry and the dependency families above. |
| `dist/renderer/assets/index-wlkGG389.js` | `5194bef4ba4cbe4f` | Roster row receives draft preview, latest-entry preview and attention/reachability data; send failures have retry/discard presentation. |
| `dist/renderer/assets/index.eager-app-DSuGVQNC.js` | `cb1f20a05ee14c4e` | Dedicated composer-draft persistence and send-journal restoration; send nonce uses `crypto.randomUUID`; persisted sidebar/detail-pane layout; row-window calculation with overscan. The latter proves a windowing helper exists, not that every transcript is virtualized. |
| `dist/renderer/assets/chunk-new-chat-bar-BqaDAl0q.js` | `0a1a27cca8e9a434` | Searchable recipient selection and group-compose state in a combobox flow. |
| `dist/renderer/assets/chunk-prompt-editor-A2oxbQX4.js` | `f99d9683b705a7b8` | Structured mention nodes, suggestion menu with arrow/Enter/Tab handling, Escape dismissal and composition guards. |
| `dist/renderer/assets/index-DkV65EBE.css` | `30beefeee1dd1b70` | Tokenized conversation spacing, bubble width, typography and sidebar sizes. Compiled variants are not measurements of the owner's active layout. |

The useful architecture is separate state for navigation, drafts, sending and transcript rendering. OpenBot can implement those responsibilities with its existing React store and Host APIs; it does not need Grok's framework stack, account synchronization or backend.

## Interaction analysis

### Navigation should answer who needs attention

The supplied screenshot uses a quiet roster with avatar, name and a single secondary line. It includes both Bots and groups, plus a visible draft preview. The transcript is the dominant surface. Search and creation are small persistent actions; global connections sit at the bottom.

OpenBot currently spends space on multiple section headings and uses different Bot/group row shapes. Bot rows show role/activity; group rows show membership. Creation is split between a large New button and a separate group action. Unifying the row and creation patterns gives a stronger improvement than decorative avatars. Core remains visibly protected and pinned, while every other Bot remains user-created.

### Reading and work status need different visual weights

The reference screenshot separates dark user bubbles, quiet assistant bubbles and compact action receipts. Status follows the conversation without becoming another settings panel.

OpenBot's B13c correctly exposes ownership, budgets and cancellation, but presents several large status blocks below the transcript. The group header also gives permanent prominence to editing and dissolution. A compact current-work row, expandable task details and a header menu can preserve every control while restoring the result as the primary content. Pending approvals must remain expanded and actionable. Paused work must explain the next user action; it must never silently restart.

### Composition is a stateful workflow

Grok's compiled client separates a draft from a send attempt and retains stable send identities. Its mention picker is keyboard-operable and its editor guards IME composition. These are implementation findings, not just styling suggestions.

OpenBot's direct Composer holds text in component state and clears it before awaiting send. A late failure can restore old text over newer typing. GroupView holds drafts in component state and remounts on group selection, losing unsent text. Both need per-conversation drafts and immutable send attempts. Recipient IDs must stay separate from display text: typing a name is not authorization to dispatch.

### Reading history must survive updates

OpenBot's private Conversation calls `scrollIntoView` whenever its snapshot changes; GroupView does so when post count changes. Someone reading older work can be pulled away by incoming activity. A shared scroll policy should follow only while already near the bottom, preserve the reading position otherwise, and offer a jump-to-latest control. This is an OpenBot code finding; no claim is made about Grok's exact scroll algorithm.

### Details should stay near the conversation

Move profile, Prompt and memory behind conversation details. Keep application language, model sources and permissions in Settings. Use the existing revision/conflict behavior when editing; a visual redesign must not replace the B19 data contract. At small desktop widths, details become an overlay rather than compressing the transcript beyond readability.

## Proposed direction

Use a neutral messaging canvas, compact roster and one consistent conversation shell. The signature interaction is a small ownership trail for group work, such as Core → Analyst → Reviewer, opening the existing durable task details. It must render actual dispatch records; no simulated progress or fabricated percentages.

Palette: canvas `#FFFFFF`, roster `#F5F5F5`, quiet surface `#ECECEE`, ink `#1C1C1E`, secondary text `#66666F`, focus `#2563EB`. Use system SF Pro Display for compact headings, SF Pro Text for body, and SF Mono only for technical details. Body 14–15 px, secondary 12 px, header 16 px. Roster 260 px; conversation reading width up to 760 px; details 320 px when space permits. These are proposed OpenBot tokens, not extracted Grok measurements. Preserve a matching dark palette and reduced-motion support.

```text
┌────────────────────┬──────────────────────────────────┬──────────────┐
│ Search         +   │ Research team             ⋯  ⓘ │ Details      │
│                    │                                  │              │
│ Core               │                  User request    │ Profile      │
│   Last reply       │                                  │ Prompt       │
│ Analyst            │ Core → Analyst · Reviewing       │ Memory       │
│   Draft: ...       │ Result and supporting evidence   │              │
│ Research team      │                                  │ Group work   │
│   Needs approval   │ [Approval, when needed]          │ details      │
│                    │                                  │              │
│ Settings           │ [Message…           @       ↑]  │              │
└────────────────────┴──────────────────────────────────┴──────────────┘
```

A persistent task dashboard was considered and rejected for the main surface: it would repeat the current competition between task metadata and the conversation. Details remain available on demand. New avatars, motion and extra panels should be added only when they communicate identity or state.

## Delivery order

1. **B21: conversation experience** — shared shell, compact roster/New flow, reliable drafts/send recovery, mention keyboard behavior, scroll preservation, contextual details and bilingual states. See the implementation spec.
2. **Later design: summaries and navigation** — durable sidebar latest-message/unread projections for groups, full conversation search, pin/hide groups and transcript windowing. These need explicit Host projections and performance acceptance rather than opening every conversation to populate a sidebar.
3. **Later design: results** — attachment ingestion and secure artifact previews, keeping local path validation and executor authorization. Connectors, voice, routines and computer control remain separate backlog capabilities.

Keep Core-only management, Core-default ordinary group messages, explicit @ routing, direct private chats, two-hop/twelve-delivery bounds, local persistence, English default and Simplified Chinese. Model inference still uses the user's configured endpoint. Do not copy Grok's cloud-computer or account assumptions into OpenBot.

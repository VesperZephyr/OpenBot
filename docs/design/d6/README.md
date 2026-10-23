# OpenBot personal assistant design study

Design proposal, 2026-10-22. See [D6](../../tasks/d6-desktop-design.md) for the audit, personal assistant direction, preservation contracts and implementation acceptance. The selected direction is warm, intelligent and approachable, with conversation at its center. This folder remains the standalone study; D6 also records the separately verified production implementation.

## Open the study

From the repository root:

```sh
python3 -m http.server 8766 --bind 127.0.0.1 --directory docs/design/d6
```

Open [the local prototype](http://127.0.0.1:8766/prototype.html). It uses four local files: `prototype.html`, `personal.css`, `avatars.js`, and `personal.js`. There are no external fonts, images, libraries or service dependencies. The original character illustration is inline SVG. The files may also be opened directly; clipboard permissions can differ by browser.

The study opens directly into a conversation. Its unified Chats list gives every Bot the same row treatment; a small, static star identifies the permanent personal assistant. The star is not a favorite control. Core has no Delete/Hide action, while other Bots retain a demo deletion confirmation. Use the top study controls for the explicit Welcome study, Conversation, Approval and light/dark appearance. On Welcome, try a conversation starter, resume the previous conversation, or edit the memory excerpt. In Conversation, open the plan preview or assistant profile. Search opens a local fixture search dialog. Returning to a Bot goes to its conversation. Settings provides a small overview of the existing categories and a working demo appearance control.

Open [the profile study](http://127.0.0.1:8766/prototype.html?view=profiles) to start with the editor and six avatar choices visible. Every fixture Bot exposes an editable name, role, instructions and avatar. Generate options/Another set produces local original vector candidates; Upload image decodes an explicitly selected file locally and previews a centered crop. Save applies changes, Cancel discards them, and renaming never changes the selected avatar or Core identity. This does not implement persistent profile assets, production import validation, crop positioning, AI image generation or the real Create Bot flow.

All content is fictional and labelled. Sending adds an in-memory preview message and does not call a model. Approval controls never run commands or save grants. Memory and instruction edits are per-Bot page state and reset on reload; they do not access OpenBot's data. Peripheral functions explain their prototype limits. Only an image explicitly selected through the avatar picker is decoded locally; it is not transmitted or persisted. No app data is read, no chat attachment is imported, and no calendar event is created. English is the study language; the implementation still requires both supported product languages.

## Verification performed

Used an isolated headless agent-browser session. The owner's OpenBot process and data were not opened or changed.

```sh
agent-browser --session openbot-d6 open http://127.0.0.1:8766/prototype.html
agent-browser --session openbot-d6 set viewport 1440 920
agent-browser --session openbot-d6 eval --stdin < docs/design/d6/verify.js
```

Reload before each run. Checks modify the demo state; reload afterward for a clean review.

- **63 checks passed at 1440×920.** Default conversation entry, equal-height chat rows, a unique noninteractive assistant star, distinct Core/Specialist lifecycle actions and deletion confirmation; welcome identity/composer, starter behavior, memory edit and safe rendering, draft preservation, conversation resume, plan preview, focus entry/return, separate Bot drafts and memories, per-Bot instruction edits, search, approval scope and visible decision, simulated denial, plain-text send, settings appearance, group metadata, page overflow and eleven contrast pairs.
- **65 checks passed at 880×680.** The compact run additionally verifies a modal preview, inert conversation/roster and visible scrim; the wide preview remains nonmodal.
- **33 additional profile/avatar checks passed at each of 1440×920 and 880×680**, using `agent-browser --session openbot-d6 eval --stdin < docs/design/d6/verify-avatars.js` on a fresh page. Covers distinct generated options, preview/save/cancel, renamed Core protection, duplicate display names without identity confusion, safe name rendering, blank-name rejection, draft retention, current names in search/group routing, unsupported image rejection and synthetic PNG import/normalization. No private image was used.
- Visually inspected the profile picker at 1440×920 and 880×680.
- Visually inspected Welcome at 1440×920, 1280×820 and 880×680; also inspected conversation, plan preview, approval, dark appearance and a 390×844 defensive layout probe. The narrow viewport measured exactly 390 px page width without document-level horizontal overflow. This is not a proposal to ship mobile OpenBot.
- The preview supports Escape dismissal, focus return and Tab containment in overlay mode. Dialogs use the native HTML dialog focus behavior. Production integration must retain the existing app's complete focus, scroll-anchor and recovery contracts.
- `node --check` passed for the interaction code and check script. `git diff --check` passed.

Review screenshots are local artifacts outside the repository, not production screenshots. This study record covers prototype checks only. Production `pnpm run check` and `pnpm run e2e` evidence is recorded in D6. D6 specifies the required implementation scenarios. No real-model test, durable memory validation, native packaged validation, Chinese layout verification or complete accessibility audit is claimed by this study.

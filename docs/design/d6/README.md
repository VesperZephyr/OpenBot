# OpenBot personal assistant design study

Design proposal, 2026-10-22. See [D6](../../tasks/d6-desktop-design.md) for the audit, personal assistant direction, preservation contracts and implementation acceptance. The selected direction is warm, intelligent and approachable, with conversation at its center. No product code is changed.

## Open the study

From the repository root:

```sh
python3 -m http.server 8766 --bind 127.0.0.1 --directory docs/design/d6
```

Open [the local prototype](http://127.0.0.1:8766/prototype.html). It uses three local files: `prototype.html`, `personal.css`, and `personal.js`. There are no external fonts, images, libraries or service dependencies. The original character illustration is inline SVG. The files may also be opened directly; clipboard permissions can differ by browser.

Use the top study controls for Welcome, Conversation, Approval and light/dark appearance. On Welcome, try a conversation starter, resume the previous conversation, or edit the memory excerpt. In Conversation, open the plan preview or assistant profile. Search opens a local fixture search dialog. Returning to a Bot goes to its conversation. Settings provides a small overview of the existing categories and a working demo appearance control.

All content is fictional and labelled. Sending adds an in-memory preview message and does not call a model. Approval controls never run commands or save grants. Memory and instruction edits are per-Bot page state and reset on reload; they do not access OpenBot's data. Peripheral functions explain their prototype limits. No local file is read or uploaded, and no calendar event is created. English is the study language; the implementation still requires both supported product languages.

## Verification performed

Used an isolated headless agent-browser session. The owner's OpenBot process and data were not opened or changed.

```sh
agent-browser --session openbot-d6 open http://127.0.0.1:8766/prototype.html
agent-browser --session openbot-d6 set viewport 1440 920
agent-browser --session openbot-d6 eval --stdin < docs/design/d6/verify.js
```

Reload before each run. Checks modify the demo state; reload afterward for a clean review.

- **54 checks passed at 1440×920.** Welcome identity/composer, starter behavior, memory edit and safe rendering, draft preservation, conversation resume, plan preview, focus entry/return, separate Bot drafts and memories, per-Bot instruction edits, search, approval scope and visible decision, simulated denial, plain-text send, settings appearance, group metadata, page overflow and eleven contrast pairs.
- **56 checks passed at 880×680.** The compact run additionally verifies a modal preview, inert conversation/roster and visible scrim; the wide preview remains nonmodal.
- Visually inspected Welcome at 1440×920, 1280×820 and 880×680; also inspected conversation, plan preview, approval, dark appearance and a 390×844 defensive layout probe. The narrow viewport measured exactly 390 px page width without document-level horizontal overflow. This is not a proposal to ship mobile OpenBot.
- The preview supports Escape dismissal, focus return and Tab containment in overlay mode. Dialogs use the native HTML dialog focus behavior. Production integration must retain the existing app's complete focus, scroll-anchor and recovery contracts.
- `node --check` passed for the interaction code and check script. `git diff --check` passed.

Review screenshots are local artifacts outside the repository, not production screenshots. Full `pnpm run check` and `pnpm run e2e` were not run for this documentation/prototype-only change. D6 specifies the required implementation scenarios. No real-model test, durable memory validation, native packaged validation, Chinese layout verification or complete accessibility audit is claimed by this study.

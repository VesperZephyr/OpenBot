# OpenBot desktop design study

Design proposal, 2026-10-22. See [D6](../../tasks/d6-desktop-design.md) for the audit, visual system, preservation contracts and implementation acceptance. No product code is changed.

## Open the study

From the repository root:

```sh
python3 -m http.server 8766 --bind 127.0.0.1 --directory docs/design/d6
```

Open [the local prototype](http://127.0.0.1:8766/prototype.html). It is one self-contained HTML file with no external font, image, library or service dependency. It can also be opened directly as a local file; browser clipboard permissions may differ.

Use the top study controls to switch between Conversation, Approval and Settings or toggle the appearance. Click the report to open its preview, Details to inspect the Bot, or another Bot to see the empty state. Type a draft and switch away and back. Search filters the example roster. The New button opens a choice dialog. These controls operate only on the example data in the page.

The app-like content is fictional and labelled. Approval decisions do not run a command or create a grant; sends do not call a model. Peripheral features outside this study show an explanatory demo notice. Reloading clears demo state. The profile and file panel illustrates geometry and focus entry/return, but does not implement production modal focus containment at narrow widths; D6 explicitly requires that for implementation. The prototype is English only, while the implementation acceptance requires both supported languages.

## Verification performed

Used an isolated headless agent-browser session. The owner's OpenBot process and data were not opened or changed.

```sh
agent-browser --session openbot-d6 open http://127.0.0.1:8766/prototype.html
agent-browser --session openbot-d6 set viewport 1440 920
agent-browser --session openbot-d6 eval --stdin < docs/design/d6/verify.js
```

Reload before each check run. The check exercises example UI state and leaves it changed; reload again for a clean review.

- **35 checks passed** at 1440×920 and 880×680: result/profile/data panels, focus entry, per-Bot drafts, drafts across settings, category navigation, search empty state, exact approval details and simulated decision, New dialog, safe plain-text send rendering, light/dark tokens, page overflow and eight foreground/background contrast pairs.
- Visually inspected screenshots at **1440×920**, **1280×820**, **880×680**, and **390×844**. The last width is a defensive layout probe for this browser-hosted study, not a mobile OpenBot feature proposal. Page width at 390 px was measured at 390 px with no document-level horizontal overflow.
- Inspected conversation, dark conversation, report preview, approval, settings and compact details. Fixed overflowing roster previews and reduced roster vertical spacing. Made the selected approval example scroll its decision controls into view; this demo initialization must not replace production scroll-preservation rules.
- Contrast checks caught two insufficient pairs. Secondary ink changed to `#5F6C80` (4.69:1 on the sidebar), and the dark solid button changed to `#3F6ED8` (4.74:1 with white text).
- `git diff --check` passed. Prototype script and browser-check JavaScript syntax were checked with Node.

Review screenshots are local artifacts outside the repository. They are not production screenshots or evidence of native behavior. Full `pnpm run check` and `pnpm run e2e` were not run for this documentation/prototype-only change. Their required product acceptance scenarios are specified in D6; no automated production coverage, real-model test, packaged validation, Chinese layout validation or complete accessibility audit is claimed here.

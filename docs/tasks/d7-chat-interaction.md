# D7: White chat canvas and focused interactions

Status: merged in PR #51. Owner-authorized refinement of D6, developed in the original checkout on `task/d7-chat-interaction` without a worktree.

## Contract

- Implement both themes from [the theme design](../design/d7-themes.md), including semantic surface/ink/state tokens and visual appearance previews. Default to a white conversation canvas, using a matching pale sidebar in Light and charcoal sidebar in Dark, retaining D6's avatars, reading width and typography. Add a local desktop appearance preference (Light, Dark, System) in Settings; default Light, persist across restarts and react to system changes only when selected. This is presentation state, not model input or a new Host capability.
- Keep one Settings entry in the chat sidebar. Place Skills, Connect apps and Routines inside a Settings navigation shell with a return-to-chat action. Existing management, permissions, models and storage controls remain available. Keep global Pause all readily accessible because stopping work is time-sensitive.
- Explain global pause/resume versus individual task continuation. A settled interrupted private task can explicitly Resume and continue from its transcript, first reopening the existing lifecycle gate and then using the existing idempotent continuation request. Do not automatically replay interrupted commands. Locked/sleeping/quitting/unsettled states remain disabled with visible explanations. Global resume gives visible confirmation and explains that interrupted tasks require continuation. Existing group cancellation remains explicit; no implicit peer restart.
- Refine the composer: compact icon attachment control with accessible label, quiet Skills control, one primary send/stop position when empty/running, stop remains accessible while composing a follow-up, clear working/queued status and steering hint. Preserve IME, Shift+Enter, stable send recovery, attachments, skills, group mentions and per-conversation drafts. Return focus after sending. No unsupported voice or queue-editing controls.
- English and Chinese copy, keyboard operation, compact window and dark contrast must remain usable.

## Design references

Approved [D6 prototype](../design/d6/prototype.html), [installed Grok Bot observations](d2-grok-ui-research.md), and [OpenAI's steer/queue explanation](https://developers.openai.com/blog/mastering-codex-remote-for-engineering). OpenBot retains its existing Host semantics: follow-ups steer direct runs at a boundary; the UI must explain that behavior rather than promise new queue capabilities.

## Acceptance

1. Dark OS appearance still opens white by default; explicit Dark and System apply and survive restart without losing drafts.
2. Sidebar contains Settings, not three separate management destinations; all three destinations work through Settings and return to the previous chat.
3. Pause during a running local command terminates it; Resume and continue produces a new answer without repeating committed effects. Queued work resumes, blocked native states explain why continuation is unavailable, and repeated clicks cannot create duplicate continuations.
4. Composer send/stop/follow-up states, IME/newline, file/skill selection and draft persistence have automated coverage.
5. `pnpm run check`, full hidden `pnpm run e2e`, inspected screenshots, and isolated agent-browser exploration pass. Update bilingual README and current-state docs to describe the shipped interaction.

## Verification

- `pnpm run check`: 506 tests passed across 77 files, with boundary checks and TypeScript checks passing.
- Full hidden `pnpm run e2e`: 153 tests passed across 43 files on 2026-10-22. Includes existing lifecycle, IME, attachment, skill, connector, routine and group coverage plus six new interaction/theme cases.
- Theme tests measure rendered normal-text contrast (at least 4.5:1), immediate theme-switch contrast, persisted appearance and System changes. Matching conversation, profile, Settings, menu, confirmation and approval screenshots were inspected in both themes, including compact Chinese layouts.
- Isolated agent-browser exploration verified the light sidebar, Settings navigation, native radio keyboard switching and pause/resume feedback. No owner-data application was launched for verification.
- English and Chinese README text and production screenshots are aligned. Dependencies and vendored builds were synchronized in the original checkout after pulling `main`.

## Open questions

None. Native packaged lock/sleep behavior remains a separate release gate; simulated events verify application contracts.

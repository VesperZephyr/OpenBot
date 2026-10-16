# B7a: Background Desktop Tests

Status: in progress
Branch: task/b7a-background-e2e
Depends on: B7
Architecture: Section 6.4 (desktop lifecycle)

## Goal

Run desktop end-to-end tests without interrupting the person using the Mac. Show test windows only when explicitly requested.

## Scope and design

`pnpm run e2e` launches the real Electron renderer, Host, and executor with hidden, non-focusable windows. On macOS the test app uses the prohibited activation policy and hides its Dock presence; tests create no tray, notifications, Dock badge updates, or power assertions. Window activation and second-instance callbacks cannot reveal a background test window. Hidden renderers keep painting and disable background throttling so Playwright interactions and screenshots work.

`pnpm run e2e:headed` sets `OPENBOT_E2E_HEADED=1` for the harness. It shows test windows for debugging but still disables notifications and other native attention effects. The harness explicitly passes `OPENBOT_E2E_MODE=background|headed`; main honors that override only for unpackaged apps with a separate `OPENBOT_DATA_DIR`. Normal development and packaged launches retain existing behavior.

Tests continue to use isolated state, scripted models, and real recovery/relaunch flows. The harness closes a partially started app and the model server if launch fails. Native visible lifecycle acceptance remains a separate explicit activity. Background mode does not virtualize the clipboard or file dialogs.

## Steps

1. Add a desktop test-mode resolver; gate window visibility, focus, activation policy, tray, and attention effects.
2. Default the e2e harness to background, add the headed command, and cover activation, approval/completion, and relaunch without native effects.
3. Run `pnpm run check` and `pnpm run e2e` in background; inspect screenshots. Verify headed selection using unit coverage without opening visible windows during this task.
4. Update README, agent instructions, task index, backlog, and technical plan.

## Acceptance

1. Default e2e windows remain hidden and non-focusable after startup, activation events, a completed approval flow, and relaunch. `e2e/background.e2e.ts`.
2. Approval/completion causes no notification, Dock badge, or power assertion. Attention watcher unit tests and background e2e instrumentation.
3. Headed mode is explicit; packaged and normal launches ignore test flags. `apps/desktop/test/test-mode.test.ts`.
4. `pnpm run check` and the full background e2e suite pass; screenshots contain the rendered UI.

## Risks

Hidden windows exercise renderer and IPC behavior but do not verify visible native interactions. Background throttling must stay disabled for deterministic rendering. The existing Copy assertion still writes the system clipboard.

## Open questions

None.

# D12b: BoardUI conversation

Status: in progress
Branch: task/d12b-boardui-conversation
Depends on: [D12](d12-boardui-refactor.md) stage 2; [D12a](d12a-boardui-foundation.md) merged in PR #88
Architecture: existing renderer and Host snapshots; no protocol, persistence or process-boundary changes

## Goal

Restyle the desktop conversation to the calm three-card layout from the BoardUI reference: a light gray workspace, floating white cards, and color reserved for Bot avatars. Blue is only for primary actions, toggles and send. Keep every existing conversation, approval and send behavior.

## Scope

In:

- Sidebar, conversation and Bot detail as three cards. The detail card is visible at 1180px and wider, and hidden while a file reader is open so the reader keeps its width. Below that width the existing Conversation details dialog remains the editor.
- Header status from the live snapshot: working, awaiting approval, or idle.
- Empty state: overlapping member avatars, the Bot's own first instruction sentence, and up to three examples taken from quoted or labeled instruction lines and skill descriptions. No examples when none exist.
- Execution summary computed by `summarizeSteps` from the tool rows already folded in the timeline. Failed calls stay their own rows and are named on the preceding summary. Seconds come from surrounding message timestamps when both exist.
- Approval callout keeps Deny / Allow once, the command, the countdown, expiry disabling, and restart survival.
- Richer V1 avatar paint in `Avatar.tsx`. Seed, motif, color index and shape stay on version 1.

Out:

- Host methods, protocol messages, storage formats, and a second avatar version.
- BoardUI Pro source, mascots, or a Bypass-all control.
- Settings, Skills, Connectors and Routines restyles beyond the shared color tokens.

## Acceptance

1. Mixed Bot and group rows, unread counts and search stay as they are. Reduced motion replaces the working dot with the text Working / 工作中.
2. Bot replies use 14px type on a 22px line. Controls stay on a 20px line. User messages stay right-aligned. Markdown and code blocks still render.
3. Approvals show the command and the once-only scope, remain keyboard operable, and do not resolve when a panel closes.
4. The composer keeps per-conversation drafts, IME-safe Enter, Stop while work is running, and uncertain retry on the same request id.
5. The detail card edits an avatar through the existing editor: reroll, motif, and upload, saved with `bots.update`.
6. Light and dark, English and Chinese. Existing e2e assertions are ported when the markup changes.
7. `pnpm run check` passes. Desktop e2e, including Check and e2e (macOS), passes on CI. Linux cannot compile the macOS keychain helper, so the full Electron suite is not claimed from this agent.

## Implementation evidence — 2026-11-03

- `pnpm run check:quick` passed on Linux (lint, boundaries, typecheck).
- New unit tests for avatar mapping, step summaries, examples and header status passed.
- Full `pnpm run test` still fails in `packages/local-executor` and `apps/desktop/test/login-path.test.ts`. Those failures are the existing Linux process-group and zsh login gaps; this change does not touch them.
- Electron e2e was not run here. The desktop build compiles `keychain.node` with the macOS Security framework, which this Linux agent does not have. Screenshots and the macOS e2e aggregate are the CI evidence.

## Open questions

- 2026-11-03: The persistent detail card is the stage-2 layout requested for this task. The full profile dialog remains the editor for memory, routines and library. Revisit if a narrow window must keep the card open beside the reader.

# D12c: BoardUI conversation polish

Status: in progress
Branch: task/d12c-boardui-polish
Depends on: [D12b](d12b-boardui-conversation.md) merged in PR #90
Architecture: renderer presentation only; no protocol, persistence or version-2 avatar migration

## Goal

Close the conversation restyle against the corrected acceptance list and the six review notes. Avatars stay version 1. `Avatar.tsx` is the only drawing implementation.

## Acceptance

1. Bots are distinguished by their avatars, not a color bar. A working Bot is named in text. The working indicator does not breathe.
2. Bot replies use 14px type on a 22px line. Controls stay on a 20px line. User messages stay right-aligned. Markdown and code blocks still render.
3. Approvals show the command and the once-only scope, remain keyboard operable, and do not resolve when a panel closes.
4. The composer keeps per-conversation drafts, IME-safe Enter, Stop while work is running, and uncertain retry on the same request id. The composer also names the model that will run.
5. The detail card opens as a read-only intro. Edit reveals the existing avatar editor plus name, label and prompt, with Save and Cancel. Explanatory text is at least 12px in the secondary text color.
6. Light and dark, English and Chinese. The large avatar in dark mode has no opaque dark box-shadow.
7. Existing assertions stay. `pnpm run check` and the macOS e2e aggregate are the acceptance run.

## Open questions

- 2026-11-04: D12b's reduced-motion-only working label is replaced by always-visible text. The roster preview string for Working stays the existing translation so the conversation-list assertion still matches it.

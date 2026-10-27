# Installed radar acceptance — 2026-10-27

## Installed baseline and actual workflow

The owner's `/Applications/OpenBot.app` was updated from `0.0.0-d9.20261024.4` to `0.0.0-b11d.20261027.1`, built from merged main `2f8141271a90d5cbfd34334a26eefa9ca866a5f5` (PR #60). The previous bundle and stopped application data were preserved outside the repository before replacement; the copied SQLite store passed integrity validation. Packaging and `codesign --verify --deep --strict` passed. This is an ad-hoc local build, not a Developer ID/notarized release.

The existing group, two Specialist identities and Core identity were retained. No replacement group or demonstration Bots were substituted. The configured default remained `claude-opus-5-5`. Resuming the previously persisted quit gate admitted the actual calendar catch-up occurrences, not Test run calls. Both researchers published into the existing group; Core consumed their exact saved reports without refetching or peer delegation.

- Domestic: 13 successful `web_fetch` calls; final report 4,943 UTF-8 bytes.
- International: 22 successful `web_fetch` calls; final report 5,216 bytes.
- Core: zero tools; summary 4,037 bytes. Both source snapshots were ready, correctly linked and untruncated. The `2/2` result measures report availability, not research completeness.
- News window: **2026-10-26 07:00 through 2026-10-27 07:00, Asia/Singapore**.

## Source-by-source audit

| Product and checked source | Evidence from the captured responses | Quality conclusion |
| --- | --- | --- |
| [Kimi Code CLI](https://github.com/MoonshotAI/kimi-code/releases) | 2.3.3 release page: `released 2026-10-26T13:22:15Z`; feed modification and commit times checked separately | In-window release verified; finite feed read through its end |
| [CodeBuddy CLI](https://www.codebuddy.cn/docs/cli/release-notes/README) | v2.177.0, dated October 26; version-specific body inspected | Date-only; exact window membership unverified. Adjacent v2.176.0 also lacks a timezone |
| [CodeBuddy IDE](https://www.codebuddy.cn/docs/ide/release-notes/release-notes) | 4.12.2, dated October 14; latest body readable | Latest checked entry predates window; older history truncated downstream |
| [WorkBuddy](https://www.codebuddy.cn/docs/workbuddy/Changelog) | 5.9.2, dated October 26; latest body inspected | Date-only; exact window membership unverified; older history truncated |
| [ZCode](https://zcode.z.ai/_next/changelog) | 3.16.3, dated October 23 | Latest loaded entries inspected; older dynamically loaded history not retrieved |
| [Qoder](https://docs.qoder.com/release-notes/qoder) | 0.4.11, dated October 23 | Correct Qoder release-note variant; latest checked entry predates window |
| [TRAE China](https://www.trae.cn/changelog) | 3.4.7, dated October 22; page mode retained product/version/date context | China source verified; international release dates were not substituted |
| [Claude Code](https://github.com/anthropics/claude-code/releases) | v2.1.311: `released 2026-10-26T21:51:23Z`; body checked against report claims | In-window release verified; finite feed read through its end |
| [Codex](https://github.com/openai/codex/releases) | 0.165.0-alpha.3: `released 2026-10-26T21:54:06Z`; explicitly a prerelease | In-window release verified, but release body supplies no concrete change details. Feed read over eight pages; later releases excluded at cutoff |
| [Pi](https://github.com/earendil-works/pi/releases.atom) | v1.4.0 with October 21 Atom `updated`; finite feed read through its end | No in-window publication verified. `updated` cannot establish publication time or prove absence |
| [OpenCode](https://opencode.ai/changelog) | v2.1.4, dated October 23; first 39,965 of 57,010 changelog characters inspected | Latest checked entry predates window; remainder and all-channel absence unverified. GitHub feed includes a separate Action component |

All eleven primary sources returned readable content. Three products have verified in-window publication times; two only have dates; five have older latest checked entries; Pi's publication remains unverified. None of these categories proves complete coverage of every release channel.

## Corrections and unattended state

An explicit audit correction was posted in the real group through Core, using the saved evidence and no new tools. Original reports remain available for comparison. It retracts the inference that Pi publication cannot be later than Atom `updated`, preserves date/timezone uncertainty and marks incomplete changelog history.

The evidence constraints were added to both existing researcher instructions. Core's input bindings were reconfirmed against the updated semantic versions. The three original schedules remain enabled at **07:08, 07:10 and 07:47 Asia/Singapore**, with the next occurrences on October 28. Actual quit/relaunch preserved the reports without duplicate publication; the work gate was open and scheduler faults were empty. The installed app was finally relaunched normally, without a debug port.

This verifies one actual catch-up chain, retained schedules and restart behavior. It does not claim that the next morning's run has already happened, nor that physical overnight sleep/lock behavior or every future model response has been verified.

## Follow-up

`web_fetch` paginates by characters while the runtime also bounds tool output by bytes/lines. Chinese pages can lose their continuation footer to the second bound. Latest version bodies were checked in this run, but older history is incomplete. A separate retrieval-quality batch should preserve continuation metadata across both limits, paginate remaining relevant history and distinguish release publication, modification and date-only evidence. This is not fixed by B14d backup/restore.

Private original reports, responses, occurrence identities and the audit note are retained in the owner's local radar report directory; private transcripts and installation backups are excluded from Git.

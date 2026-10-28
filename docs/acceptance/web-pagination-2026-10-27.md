# Web pagination and installed radar acceptance — October 27, 2026

## Candidate and execution

B4a / PR #62 is based on main after merged PR #61. Installed candidate `0.0.0-b4a.20261027.1` includes the B4a product change from `b1dfb4b`. The ad-hoc arm64 bundle passed `codesign --verify --deep --strict`. The previous installation and stopped application data were backed up locally before replacement; credentials, personal configuration, raw transcripts and screenshots are excluded from Git.

The existing radar group, two existing researcher Bots and existing Core were reused with the owner's configured Opus 5.5 provider. This did not create new Bots or a product-specific integration. Both source routines were temporarily scheduled for 16:28 Asia/Singapore; Core's summary for 16:29 waited for them. All three were calendar-triggered, non-test occurrences and completed with published reports. The news window remained October 26 07:00 inclusive through October 27 07:00 exclusive in Asia/Singapore (October 25 23:00Z through October 26 23:00Z), independent of afternoon retrieval.

- Domestic: 16 successful web_fetch calls, 5,159-byte report.
- International: 26 successful web_fetch calls, 5,146-byte report.
- Core: zero tools; both exact input snapshots ready and untruncated; 4,464-byte summary.
- All eleven primary sources reached the end of their extracted response. Each paginated chain had contiguous exclusive offsets and one unchanged content hash. Continuation calls supplied contentHash. No response exceeded the byte/line budget or lost a continuation to Pi truncation.
- Normal enabled schedules were restored to 07:08, 07:10 and 07:47 Asia/Singapore for October 28. Summary bindings were reconfirmed against both current source execution revisions (8). Scheduler diagnostics had no faults. After full installed-app restart, report text and occurrence history were unchanged, and exactly one group post remained for each of the three new occurrences; lifecycle admission stayed open.

## Per-source evidence

Ranges below are UTF-16 code units of the actual extracted response. “Complete extraction” covers that response only, not complete historical or dynamically loaded site content. Original publication, modification and tag creation remain different evidence kinds.

| Product / primary source | Extraction and pages | Publication evidence and conclusion |
| --- | --- | --- |
| [Kimi Code CLI](https://github.com/MoonshotAI/kimi-code/releases.atom) | 0–87,349, 3 pages | [2.3.3](https://github.com/MoonshotAI/kimi-code/releases/tag/%40moonshot-ai%2Fkimi-code%402.3.3) explicitly released at 2026-10-26T13:22:15Z; body read; verified in-window stable release. Atom updated 14:01:21Z was kept separate. Finite feed is not exhaustive history. |
| [CodeBuddy CLI](https://www.codebuddy.cn/docs/cli/release-notes/README) | 0–32,796, 1 page; two linked version bodies read | [v2.177.0](https://www.codebuddy.cn/docs/cli/release-notes/v2.177.0) is dated October 26 without time or timezone. Adjacent v2.176.0 is dated October 25. Neither establishes an exact 07:00 boundary; report retains uncertainty. |
| [CodeBuddy IDE](https://www.codebuddy.cn/docs/ide/release-notes/release-notes) | 0–20,533–44,000–58,749, 3 pages | Latest checked 4.12.2 is dated October 14; older source context only. Previous byte truncation is resolved. |
| [WorkBuddy](https://www.codebuddy.cn/docs/workbuddy/Changelog) | 0–20,742–42,246–60,535, 3 pages | 5.9.2 is dated October 26 without time/timezone, so exact-window publication is unverified. Previous byte truncation is resolved. |
| [ZCode](https://zcode.z.ai/_next/changelog) | 0–3,466, 1 page | 3.16.3 is dated October 23. Static response ends but “Scroll to load more” entries were not retrieved. Summary marks partial/unverified, not no update. |
| [Qoder](https://docs.qoder.com/release-notes/qoder) | 0–21,417, 1 page | 0.4.11 is dated October 23; only the configured Qoder variant was checked. No exact-window release verified from this source. |
| [TRAE China](https://www.trae.cn/changelog) | 0–4,466, 1 page in page mode | Latest checked TRAE v3.4.7 is dated October 22. Product columns preserved. Load-more entries remain unchecked; summary marks partial/unverified. International TRAE was not substituted. |
| [Claude Code](https://github.com/anthropics/claude-code/releases.atom) | 0–86,221, 3 pages | [v2.1.311](https://github.com/anthropics/claude-code/releases/tag/v2.1.311) explicitly released at 2026-10-26T21:51:23Z; body read; verified in-window stable release. |
| [Codex](https://github.com/openai/codex/releases.atom) | 0–294,491, 8 pages | [0.165.0-alpha.3](https://github.com/openai/codex/releases/tag/rust-v0.165.0-alpha.3) explicitly released at 2026-10-26T21:54:06Z and labelled prerelease. Its body only names the release, so no feature claims were invented. Alpha.2 has tag time only. Alpha.1.1, alpha.1.2 and 0.166.0-alpha.1 were published after cutoff and excluded. Finite feed does not prove absence of a stable release. |
| [Pi](https://github.com/earendil-works/pi/releases.atom) | 0–123,417, 4 pages | [v1.4.0](https://github.com/earendil-works/pi/releases/tag/v1.4.0) explicitly released at 2026-10-21T22:49:48Z; body read. This closes the earlier updated-only uncertainty for this version, not all historical releases. It remains background outside the news window. |
| [OpenCode](https://opencode.ai/changelog) | 0–39,965–57,010, 2 pages in page mode; repository feed also read completely | Changelog v2.1.4 is dated October 23. Repository v2.2.0 has only tag creation at 2026-10-27T08:09:49Z, not verified publication. GitHub Action versions remain separate. The previously unread changelog tail is now covered. |

## Quality assessment

Three products have verified original publications inside the requested window: Kimi, Claude Code and Codex (the latter a prerelease). Two domestic products have date-only boundary uncertainty. ZCode and TRAE have unresolved dynamic history. The remaining older evidence cannot support whole-site absence claims. The automatic summary preserves these distinctions in its eleven-product ledger, explicitly separates report availability from source coverage, and states that finite feeds and tag/updated times do not establish exhaustive release coverage.

The reports and summary were opened in the installed group using agent-browser. The rendered summary visibly labels dynamic gaps and uncertain dates. Raw evidence and a per-request range ledger remain in the owner's local report folder. No external messages were sent; the Host delivered only to the configured local group.

## Automated regression and limits

- `pnpm run check --maxWorkers=4`: boundary checks, type checking and 569 tests across 84 files passed. Four workers avoid the existing filesystem-heavy timeout sensitivity without changing assertions.
- Unit fixtures reconstruct multilingual, Emoji, long-line and many-line documents exactly; validate output budgets, changed content, invalid offsets, oversized metadata, body limits and distinct publication/modification evidence.
- The desktop fixture routes three multilingual pages through the actual Host, Tool Router and Pi into captured model input, reconstructing every body character including the final release timestamp.
- Initial full desktop pass had 184 passing cases and one screenshot interaction timeout: the new test clicked a tool card inside a collapsed step group. It was corrected to expand the group first; data reconstruction assertions already passed. The final full `pnpm run e2e` passed all 185 cases across 48 files.
- Static fetching does not execute JavaScript or automatically exhaust linked site pagination. Content changes between requests fail visibly and need a restart or smaller source. This acceptance observed one real scheduled chain, not a multi-day reliability guarantee. The candidate is locally ad-hoc signed, not a notarized release.

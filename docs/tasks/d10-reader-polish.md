# D10: Reader polish and real report acceptance

Status: done — merged in PR #59
Branch: task/d10-reader-polish
Depends on: D9 (merged in #58), I6 (merged in #57)
Architecture: existing desktop readers and immutable file artifacts; no protocol or module-boundary changes

## Goal

Make the existing right-hand readers consistent and comfortable for actual Bot-generated reports, and verify message-card delivery through multiple reader tabs in the installed application.

## Scope and contracts

- Reuse Lucide React through the existing icon component. Reader icons use consistent dimensions and stroke weight; centered 28-pixel controls retain accessible names, keyboard focus and tooltips. Bundle the dependency notice. Preserve application colors and typography.
- Group zoom controls explicitly for all formats. Keep source/export actions in a separate trailing group. Remove decorative file-card icon rotation.
- Let tabs share available width to a bounded minimum before horizontal scrolling. Truncate the basename while preserving the extension and full accessible title. Keep both close buttons visible when two long-name tabs fit.
- Distinguish page loading from file loading and keep loading feedback usable in short panes.
- Preserve D9 tab identities, bounded capacity, native browser isolation, resource cleanup and reading-state retention. Do not change model tools, file persistence, routines or permissions.
- Generate and publish Markdown and interactive HTML from the existing verified radar report using the configured real model. Label this as delivery/reading acceptance, not a fresh competitor crawl. Keep personal reports and screenshots outside Git.

## Steps

1. Update InterfaceIcon, reader controls, reader CSS and the bundled dependency notice.
2. Extend ScriptedModel group artifact coverage for both card clicks, tab switching, HTML filter retention, Markdown zoom, drafts, long names and closure. Measure control geometry and web zoom adjacency.
3. Run check and the hidden desktop suite, inspect light/dark/narrow screenshots, and explore isolated readers with agent-browser.
4. Package and update the owner's app while idle with an app/data backup. Open the actual generated cards, switch tabs, resize and close/reopen them. Verify existing model and daily routines remain unchanged.
5. Record evidence and deliver this follow-up independently of merged D9.

## Acceptance

1. Consistent icons, hit areas, retained filename extensions and visible close buttons: group-pair artifact e2e and screenshot inspection.
2. Adjacent zoom controls, independent reading state, draft preservation and predictable closure: artifact and file e2e scenarios.
3. Actual generated files open from messages in the installed app; HTML filters and Markdown zoom survive switching: native real-report inspection.
4. Boundaries, types, unit invariants and the full hidden desktop suite remain checked; distinguish automated coverage from real-model acceptance.
5. Installation preserves model configuration, routine revisions/times and accepted report counts; no release publication.

## Risks

Shared icon changes affect more than readers, so inspect other chat controls and retain the full desktop regression. Narrow panes must continue scrolling once minimum tab widths are reached. Real reports remain private and must not become test fixtures.

## Open questions

None.

## Acceptance evidence

- Boundary and type checks pass. The 537-test unit suite passed before the final CSS tab-sizing refinement; later full checks passed 535 tests with two disk-heavy cases timing out under local contention. Both affected files (11 tests) passed an isolated single-worker rerun without changing assertions or timeouts. Full hidden `pnpm run e2e` passed 175 tests across 46 files, including the group Markdown/HTML card pair and responsive tab sizing.
- Inspected generated-file, resized three-column, Markdown, PDF, long-name group file pairs and Chinese dark/minimum-window screenshots. Isolated agent-browser exploration verified the divider, embedded HTML interaction and page state after switching file tabs.
- ScriptedModel cases cover both pointer/keyboard dividers and width persistence, simultaneous chat streaming and reading, drafts, generated file cards, responsive Markdown/PDF, HTML resize/modal ownership, formats/errors and Chinese/dark/minimum-width layouts. Multi-tab coverage also checks icon geometry, grouped zoom controls, visible extensions and close buttons for long filenames. It verifies Markdown scroll/zoom, PDF page, two native page states and visibility, duplicate workspace/native/web opens, keyboard navigation/closure, URL validation, chat/document links and narrow tab overflow.
- Built and installed `0.0.0-d9.20261024.4` after backing up the previous app and local data; deep/strict signature verification passed. The configured real model generated and published a new Markdown/interactive HTML pair from the existing verified radar report. This was a reading/delivery acceptance, not a new competitor crawl. Both message cards open in separate right-hand tabs in the installed app.
- Installed-app inspection verified the overseas filter survives switching to Markdown and back, narrowing/restoring the pane preserves page interaction, file extensions and close buttons remain visible, and closing HTML selects the Markdown with its 110% zoom retained. Both file tabs are left available for inspection. Private screenshots and report contents remain outside Git.
- Rechecked all three enabled daily schedules (07:08, 07:10 and 07:47 Asia/Singapore), unchanged revisions/report dependencies, exactly one copy of each accepted report and unchanged model configuration after restart.
- Native installed acceptance covers the actual generated Markdown/HTML pair; earlier acceptance also opened a live HTTP(S) page. Automated desktop acceptance separately covers independent browser visibility and PDF page retention. File previews themselves do not invoke a model.
- The package remains ad-hoc signed for local acceptance, not a Developer ID/notarized release. Owner data and screenshots stay outside Git.

- Delivery reconciliation: D9 merged at `da7e76b` in #58. The D10 application, dependency and test files are byte-identical to validated `6146380`; rebasing onto merged main changes only ancestry and documentation.

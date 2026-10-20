# I2: MVP Acceptance Candidate and Bilingual Introduction

Status: in review (#40)
Branch: task/i2-mvp-acceptance; PR target: main
Depends on: merged main through B14e (#38), B9b (#39, candidate `488ee67`)
Architecture: Sections 1–3 and 6; G0 in the development roadmap

## Goal

Deliver a reproducibly checked MVP candidate, exercise useful work with a real configured model, and introduce the actual application through an English README, a complete Chinese translation and a reviewed screenshot.

## Scope

In: integration acceptance of existing capabilities, synthetic file/report workflows, approval and restart checks, an installable development build, accurate onboarding documentation, and an authentic application screenshot. Fix regressions only within existing task contracts, with focused coverage.

Out: routines, browser/desktop control, new connector capabilities, Pi updates, production data migration, merging to main, release publication and selecting a project license. Native release identity and physical lifecycle evidence remain separate gates.

## Contracts

1. Keep all existing protocol, policy, persistence and module boundaries. If acceptance reveals a defect requiring a new contract, record it under Open questions before changing that contract.
2. Use isolated data, workspace and Keychain services. Desktop verification remains hidden and non-focusable with native attention effects suppressed. Do not open the owner's installed application or change its data.
3. Model spot checks may use the configured provider only in isolated state; credentials stay in memory/the test service and are removed afterward. Record sanitized assertions and token usage, never raw secrets or personal task data.
4. Capture the real application with synthetic input and verified results. No fabricated UI, replaced response text or mock capability claims. Commit only the selected public screenshot; raw test state and logs stay ignored or outside the repository.
5. `README.md` is English by default and links to `README.zh-CN.md`; both describe the same capabilities, setup, trust model and release limitations. Chinese documentation is explicitly requested by the owner for this task.
6. B9b remains a reviewed dependency until the owner merges it. The candidate may include its existing commits, but this branch introduces only I2 work. Distinguish automated acceptance, real-model spot checks and unverified native release claims.

## Steps

1. Audit current code, task evidence and MVP/G0 requirements. Save this spec before changes.
2. Run the complete check and background e2e suites. Exercise a synthetic report workflow with actual file verification, exact approvals, denial and restart persistence; preserve a meaningful automated regression if a gap is found.
3. Exercise a configured real model with bounded synthetic work and verified results. Explore the isolated app using agent-browser. Inspect light/dark, English/Chinese and minimum-width screenshots.
4. Build the arm64 development DMG, verify the ad-hoc signature and bundled Host/executor startup. Keep Developer ID, notarization, native notification/physical lock/sleep and update continuity limitations explicit.
5. Capture and review a clean English product screenshot; write both READMEs with working relative links, current setup examples, real capabilities and a clear roadmap.
6. Update current-state docs and the acceptance evidence, commit/push and open a reviewable PR targeting main. Do not mark unmerged work done.

## Acceptance

1. `pnpm run check` and full hidden `pnpm run e2e` pass on the candidate; failures are resolved or recorded as blockers, with screenshots inspected.
2. A useful synthetic file/report workflow produces independently verified results; an unauthorized action is denied, restart preserves completed results/memory and does not duplicate side effects. Automated and real-model evidence are labeled separately.
3. A new arm64 DMG builds; bundled startup and deep/strict ad-hoc signature verification pass. Unsupported native release claims are explicitly outstanding.
4. Both READMEs accurately explain the current product, prerequisites, startup, provider setup, examples, verification, local data/network boundaries, roadmap and licensing status. Language links and local assets resolve.
5. The committed screenshot shows the actual application and synthetic task content, has readable layout and contains no credentials, private data or temporary paths. Its provenance is recorded.

## Risks

Real provider output and availability vary; numerical/file assertions determine success, not confident assistant prose. Current development signing does not establish distributable release identity. No root project license has been selected; third-party licenses do not license OpenBot's own code.

## Open questions

None for this acceptance scope.

## Evidence

Implementation findings:

- The first complete desktop run passed 118/120 tests. The unread group assertion queried the renderer immediately after observing the Host projection; it raced the bounded UI refresh. Its failure prevented the following draft setup, causing the second failure. The isolated six-test search suite passed unchanged, then the assertions were changed to await the actual visible rows. The focused search and new workflow suites passed all eight tests.
- A real model used title-only result names, causing correct format rejection before it retried with filenames. The existing artifact contract is unchanged; its model-facing `name` description now explicitly requires the supported extension or omission. This is guidance for the existing parameter, not a new file-format or authorization rule.
- A subsequent real-provider run failed after saving the report with `invalid_request_error`. Existing files/receipts survived. Recovery is checked using an explicit follow-up, with a calculation counter proving the command is not rerun.
- CI run `39234400545` passed 121/122 desktop tests and exposed a separate HTTPS disconnect timing assumption: local invalidation is published before asynchronous remote session cleanup. The test now awaits the fixture's DELETE receipt independently of the local disconnected state. CI screenshot collection now matches suite subdirectories and includes the hidden `.run` directory, restricted to PNG files.

Final candidate checks and public screenshot provenance are recorded in [the acceptance record](../acceptance/mvp-2026-10-19.md).


Final checks: `pnpm run check` passed 461 tests / 69 suites; full background `pnpm run e2e` passed 122 tests / 34 suites; focused workflow/search passed 8 / 2. The arm64 DMG built, bundled Host/executor startup passed, deep/strict ad-hoc signature and DMG checksum verification passed. The real model verified exact approval/denial, report values, immutable copies, restart/new-topic memory and explicit provider-error recovery without repeating the command. Temporary credentials were deleted. The 1440 × 900 screenshot was inspected and committed; both READMEs and local links were checked. Native release gates remain explicit in the acceptance record.

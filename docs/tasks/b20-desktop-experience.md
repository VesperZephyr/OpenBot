# B20: Desktop Experience and English / Chinese

Status: done (#9)
Branch: task/b20-desktop-experience
Depends on: B17
Architecture: Sections 5.7, 8

## Goal
Make the desktop feel like a focused personal assistant, with English by default and an explicitly selected Simplified Chinese interface. Keep existing Pi execution, context, thinking and memory behavior.

## Scope
In: existing desktop surfaces, onboarding, language setting, native labels, visual hierarchy, responsive layout, automated coverage and isolated real-provider acceptance.
Out: new agent mechanisms, memory revision architecture, management tools, groups, browser control, connectors, routines, Bun support. B18/B19 and group specs remain draft pending separate design.

## Design
Use a cool white conversation canvas, soft gray roster, compact black Core mark and black user messages. System fonts only: SF Pro Display for headings, SF Pro Text for body, SF Mono for technical output. Tokens: canvas #ffffff, sidebar #f5f6f8, surface #fafbfc, raised #eef0f3, ink #202329, muted #626b78, border #e4e7ec. Reserve blue for focus and amber for activity. Keep the same controlled color hierarchy in dark mode. Reading width is 760px; settings use clearly separated sections and a local navigation row. Layout works at the existing 880px minimum width. Respect reduced motion and keyboard focus. No remote assets.

Use an explicit translation catalog for application-owned text. UI language does not alter saved Bot names, labels, instructions, memory, transcripts, provider names, model output or external diagnostics. Dynamic values are interpolated into translated labels. Language changes apply immediately and persist in the local Host settings document. No locale inference, remote translation, telemetry or new model requests on switch.

## Contracts
- RedactedSettings and settings.update add language?:"en"|"zh-CN"; absent stored value projects English.
- Runtime SettingsDoc stores language; Host reads/writes it without touching Bot documents or Pi sessions.
- Renderer and native desktop labels share a pure translation catalog. Native app labels use the persisted preference once Host settings load.
- Native notifications contain localized completion/approval status; raw errors remain inside the app. Bot names are unchanged.
- No change to model/policy/executor protocols besides the language setting.

## Steps
1. Extend settings persistence/schema and translation catalog; localize existing application controls.
2. Refine roster, Core mark, conversation empty state, composer, onboarding and settings styling.
3. Add locale persistence/content-preservation and minimum-width e2e coverage; run check and background e2e and inspect screenshots.
4. Launch an isolated desktop with a private copy of the configured model file. Test a short connection request, real conversation, authorized file write/read, memory across New topic, user-created Specialist, and restart persistence. Only synthetic inputs and isolated workspace paths. Inspect through agent-browser. Keep credentials and acceptance artifacts out of Git.

## Acceptance
1. Unit tests cover valid/invalid locale and persistence; no Bot state mutation from changing locale.
2. Background e2e covers English default, Chinese controls, switch back, restart persistence and unchanged user content.
3. Existing e2e covers configuration, Core lifecycle, creation/edit/delete, memory, approvals, Stop and failures; all remain background.
4. Inspect English/Chinese screenshots at default and minimum window sizes; no clipped controls or horizontal page overflow.
5. Record real-provider spot checks separately from deterministic coverage, including any unavailable capability. No assertion that all providers or packaged permissions were exercised.

## Risks
Long translations may wrap; sections and button rows must tolerate it. Provider/command errors remain source text. Real model behavior is nondeterministic; use scripted tests for regression and report exact spot-check outcomes.

## Open questions
None.

## Verification
- `pnpm run check`: 189 tests in 29 files passed.
- Background e2e: 31 tests in 13 suites passed, including locale persistence, unchanged content, model-form draft retention and minimum-width rendering. Inspected English/Chinese screenshots and the running desktop through agent-browser.
- Fixed a recovery-test race by waiting for the model request carrying the uncertain-execution result.
- Real-provider spot check: the locally configured custom provider, short model test, Core memory update and file write/read, Cedar recall after New topic, user-created Verifier obeying its READY instruction with empty memory, shell command approved once, restart retaining Core identity/history/memory/language. Inputs were synthetic; data/workspace/config copy were isolated outside Git.
- The real model initially guessed `/app` for a file path. An approval appeared; the attempted write failed because the directory was unavailable, then the model used a workspace-relative path successfully. The temporary test grant was revoked. No inference that other providers or packaged OS permissions were verified.

# D12a: BoardUI Foundation and Settings/Chooser Pilot

Status: in progress
Branch: task/d12a-boardui-foundation
Depends on: [D12's selected direction](d12-boardui-refactor.md); existing D7–D10 desktop behavior
Architecture: existing renderer boundary and theme ownership; no Host Runtime, protocol or persistence changes
Baseline: product `f45a707`; D12 design `53a24ff`; dependency/source review on 2026-11-02

## Goal

Establish a small, locally maintained UI foundation from verified free BoardUI source. Prove that it coexists with OpenBot's current CSS, appearance preference, keyboard handling and native file readers through three bounded surfaces: Language, Appearance and New conversation. Leave the conversation redesign to D12 Stage 2.

Ready means the source, dependency choices, behavior and acceptance below are fixed. It does not mean the Electron integration has already passed acceptance. Claim and deliver this task on its own implementation branch/PR using [the task workflow](README.md).

## Scope

In:

- Renderer-only Tailwind integration, semantic style adapter and the selected source files below.
- General Settings' Language select and Appearance choices; the existing New conversation chooser, including **Create new Bot**, **Create group** and **Import template**.
- The minimal shared Button, Select, RadioCard and OpenBot Dialog interfaces required by those surfaces. Extend the existing icon abstraction only for needed slots/glyphs.
- Explicit coexistence between React Aria and legacy dialog focus handling; cascade layers for the pilot, source/license records and bundled notices.
- Mechanical enforcement of renderer UI import boundaries and focused regression coverage, followed by full checks.

Out:

- Other Settings fields, onboarding's native Language select, the destination Bot/group/template editors, navigation chrome, chat, composer, approvals and reader styling. Their existing behavior must pass regression checks.
- BoardUI application templates, Settings Modal, Pro files, artwork, charts, motion packages, the BoardUI CLI/MCP/agent rules, Next.js and new backend routes.
- New settings keys, APIs, storage formats, execution behavior, workspace packages, feature flags, owner-data verification or installation into the owner's app.

## 1. Pinned source and dependency contract

### Free source revision

Use [BoardUI/boardui at `ec5c5eb3e29c2441be63b9422cd54f411ef23466`](https://github.com/BoardUI/boardui/tree/ec5c5eb3e29c2441be63b9422cd54f411ef23466), commit date 2026-10-03, message `Export from boardui bf69775`. Its root [LICENSE](https://github.com/BoardUI/boardui/blob/ec5c5eb3e29c2441be63b9422cd54f411ef23466/LICENSE) is MIT. The repository's `package.json` version `0.1.0` describes its demo application; it is not a component release. The commit SHA is the component version for this task. Do not resolve `main`, `latest` or a CLI registry during implementation.

Import only these seven source files, retaining relative structure below `apps/desktop/src/renderer/src/ui/boardui/`. Copy the root LICENSE there. The original-byte hashes below anchor provenance before local adaptations.

| Upstream path | Original SHA-256 |
| --- | --- |
| `components/base/buttons/button.tsx` | `b147c988c73dd8c226ab6ede3d7019eac9a7125191bbd646fcdd25bea803ca41` |
| `components/base/select/select.tsx` | `c56abf0ad7b554a363a6e2b46045489b6a94c18718324cbf06e64edf0540b116` |
| `components/base/radio/radio.tsx` | `2d0d68454e0dfb9a836fc5f76089ea602aeaf427517885ddff2b568ac2a691ec` |
| `components/base/radio/radio-card.tsx` | `ebb32d094fafa5a79e73d3a0d68f40763326f7995e26c75ed1464b85868580a3` |
| `components/base/dropdown/menu-styles.ts` | `98673114fe832b05991f61a84728873a5d3985fd382e66523958321572ab63db` |
| `utils/cx.ts` | `db35ea5afa8b2e0fd51319bc49288c4df7c98ec53440b43903636a32e3319d9d` |
| `utils/use-dismiss-on-outside-press.ts` | `01c70c3b25018e9c8d1d6d84ca67facb9392b5d4baf1c7207bbcfe13d4b33699` |

The LICENSE hash is `7a28c78354f8f88d8773f72bf37fb9c037817f8abd2fa5a63694d6c946a5ce80`. Record the upstream URL and SHA, each original path and hash, and the adaptation reason in `apps/desktop/src/renderer/src/ui/boardui/README.md`. A separate machine-readable import file is not required for this delivery. Preserve copyright/provenance notices. Future imports are outside this task.

The fixed free snapshot has no standalone base Modal. Build OpenBot's small controlled Dialog from `ModalOverlay`, `Modal`, `Dialog` and `Heading` in React Aria Components; do not pull in the application Settings Modal or fetch a newer registry item. This is part of the selected free-component-plus-owned-composition direction.

### Direct package pins

Add exactly four direct packages to `apps/desktop/package.json` **devDependencies**, matching the desktop's existing convention for bundled renderer libraries. Update `pnpm-lock.yaml` using pnpm 9.12.0; do not disable peer checking or change existing React/Vite versions to make the import work.

| Package | Exact version | Role and license |
| --- | --- | --- |
| `react-aria-components` | `1.17.0` | Select/radio/overlay behavior; Apache-2.0 |
| `tailwind-merge` | `3.6.0` | Class conflict resolution, including BoardUI typography; MIT |
| `tailwindcss` | `4.3.3` | Generated renderer styles; MIT |
| `@tailwindcss/vite` | `4.3.3` | Renderer Vite integration only; MIT |

The first two use the concrete minimum versions in the pinned BoardUI manifest. Tailwind and its Vite plugin use a matched verified v4 pair. Package metadata was checked at the exact registry records for [React Aria](https://registry.npmjs.org/react-aria-components/1.17.0), [tailwind-merge](https://registry.npmjs.org/tailwind-merge/3.6.0), [Tailwind](https://registry.npmjs.org/tailwindcss/4.3.3) and [the Vite plugin](https://registry.npmjs.org/@tailwindcss%2Fvite/4.3.3).

The strict-peer probe resolved successfully with existing React/React DOM `19.3.1`, React types `19.3.0`, Vite `7.3.7`, TypeScript `7.0.2`, Node `22.22.2` and pnpm `9.12.0`. React Aria's peer range admits React 19; the Vite plugin admits Vite 7. Retain the repository's Node version and CI platform configuration.

Relevant transitive dependencies include `react-aria@3.48.0`, `react-stately@3.46.0`, shared React types/internationalization, and build-only Tailwind Node/Oxide plus Lightning CSS. The probe resolved `@react-types/shared@3.37.0`, `@internationalized/date@3.12.4` and `lightningcss@1.32.0`. These are dependency closure, not additional product features or new direct dependencies. The implementation lockfile owns final transitive versions/integrities; review differences from this probe and all peer/engine warnings. Do not add blanket overrides to flatten the graph.

No `@remixicon/react`, `motion`, Next.js, AI SDK, chart/table package or PostCSS plugin is needed. Remove the button's dependency on `utils/directional-icon.ts`; supply existing OpenBot icons through slots. Replace Select's BoardUI chevron import with an OpenBot icon slot. This closes the source graph without importing a second icon library.

## 2. Required local adaptations

### Source compatibility

1. Rewrite `@/` imports to local relative imports within the UI directory; no application-wide alias is needed. Remove client-boundary directives from these renderer-only files to avoid Vite's ignored-directive warnings.
2. Fix Select's `items={items}` spread: omit `items` when it is `undefined`. The unchanged source fails OpenBot's `exactOptionalPropertyTypes`; do not use `any`, `@ts-ignore` or relax tsconfig to bypass it.
3. Give Select a real visible React Aria `Label`, associated with its trigger, and keep stable option IDs/text values. The pinned source does not implement the current website's advertised visible `label` API; implement the small local adapter explicitly.
4. Adapt RadioCard to include the existing decorative appearance preview without truncating translated labels. Keep one radio group and actual radio inputs; previews are hidden from accessibility APIs. Preserve the existing Light/Dark/System values and do not turn these into three toggle buttons.
5. Use only the pilot's neutral button styles. Prune unused button variants/link exports if they would require unused theme recipes. Chooser action rows allow a wrapping title/description; do not keep the upstream fixed-height, nowrap label layout for multi-line actions. The close action uses an existing OpenBot icon with a translated name and at least a 32-pixel hit area.
6. Retain the non-modal Select outside-press/trigger-toggle workaround with its reason and removal condition adjacent to the hook. Validate against the fixed React Aria version before simplifying it. Escape/typeahead and pointer behavior must be tested, not inferred from the source comment.

### CSS isolation and theme

Use the `ob:` Tailwind utility prefix, including modifiers and marker classes, and configure `cx`/tailwind-merge with the matching `ob` prefix. Preserve its custom typography class groups so text size and text color do not overwrite each other. Keep class names statically discoverable.

Configure the Tailwind plugin only in `electron.vite.config.ts`'s renderer plugins. Import Tailwind theme and utilities separately with explicit layers, `prefix(ob)` and utilities `source(none)`; enumerate only the UI source directory with `@source`. Keep pilot utility class strings inside that directory; application containers use the components and scope marker. Do not scan the repository or import Preflight, BoardUI `globals.css`, its full theme or full typography stylesheet. The [Tailwind Preflight guide](https://tailwindcss.com/docs/preflight) supports omitting the reset; the isolated build verified this setup.

OpenBot's existing root font size is 14px. Upstream rem-based typography and spacing assume a different root size, so copying them directly shrinks the controls. Define the pilot's dimensions in pixels: spacing unit 4px, ordinary control radius 8px, `2lg` radius 10px, menu/dialog radius 16px, and default control height at least 36px. Keep the chooser's action rows content-sized. Define only used typography aliases: body 14/20px, secondary body 13/18px and caption 12/16px, with their intended weights. Do not change the root font size to 16px.

Keep [D7's theme roles](../design/d7-themes.md) and `appearance.tsx` as owners. Use `@theme inline` aliases to the existing CSS variables for primary/secondary text, default/hover/selected surfaces, borders and focus. Use `--muted` or `--accent` for essential control outlines that need 3:1 contrast; the subtle existing `--border` remains suitable for decorative separators, not a substitute for an identifiable input boundary. The selected radio uses OpenBot's accent and its contrasting indicator ink, not an imported blue ramp. Map the font to the existing system font. Use only the tiny shadow/token subset needed by these controls. No duplicate `.dark` state, theme provider or appearance storage key is allowed.

Declare cascade layers in the order `legacy`, `theme`, `ob-base`, `ob-utilities`. Put every existing renderer stylesheet, including vendored reader CSS, in `@layer legacy` without changing its relative order. A scan of those sheets found `!important` only on `.reader-open-file`, reduced motion inside `.conversation-shell` and `.sidebar`, and two avatar size overrides. Those selectors do not target the pilot, and keeping them in the same layer preserves their current wins. Do not add `[data-openbot-ui]` exclusions to legacy element rules. Mark each migrated surface and each portalled menu/dialog with `data-openbot-ui` so the scoped base and portal resets apply. Add that scoped base in `ob-base` for the form-control, border-style, margin and box-sizing defaults the new controls need without Preflight. Utilities in `ob-utilities` then override the base. A parent marker inside Settings does not cover a portal under `body`.

Do not wrap the whole application in the new scope, reorder all legacy styles, use `all: unset`, or fix leakage with accumulating `!important`. Existing chat, approval, Markdown, PDF and reader styles stay outside the marker. Reduced-motion styles inside the marker disable transitions/transforms without hiding selected, loading or focus state.

### Ownership and enforcement

New `ui/` components accept data and callbacks. They may import React, React DOM, React Aria Components, tailwind-merge, other UI files and the existing pure `InterfaceIcon` module; application state/actions stay in the existing containers. No store, protocol, preload, Host, Pi, Node or Electron imports belong in `ui/`.

Extend `scripts/check-boundaries.mjs` with this renderer UI import rule and tests under `scripts/test/`. Resolve relative paths before checking; cover static imports, re-exports and literal dynamic imports. Reject application/store imports even through relative traversal, with the violating path and the remedy (pass state/actions as props). Keep `InterfaceIcon` pure and limited to its React/Lucide dependencies. The rule runs through existing `check:boundaries`/`check`; do not claim it is already enforced before implementation. This is a maintainability boundary, not an OS or malicious-code sandbox.

## 3. Pilot behavior contracts

### Language and Appearance

- Language offers only `en` / English and `zh-CN` / 简体中文. Use the existing `settings.update` → refresh/error-report path. Opening, navigating or dismissing the popup does not save; committing a changed option does. The Host setting remains authoritative and a rejected update does not show a successful language change.
- Keep the visible Language label and caption. Support keyboard open, arrow selection, typeahead, Enter commit, Escape cancel and outside-press dismissal. Pressing an open trigger closes it once. Closing returns focus to the trigger, and Settings scroll position does not jump.
- Appearance keeps the `openbot.appearance` key, initial Light preference and existing `data-theme` behavior. System alone follows OS changes. Selecting a mode persists without changing conversation/profile drafts or recreating the application store.
- Arrow keys and Space operate one named appearance radio group. The whole card is clickable; decorative previews do not add extra tab stops. A storage failure uses existing error reporting and leaves the applied preference unchanged.
- Language changes update accessible names and document language without translating user-authored content. Onboarding's Language control remains native; update only tests that address the migrated Settings control.

### New conversation and focus handoff

- Preserve pointer New and the existing Command/Ctrl+N entry. Keep the dialog's translated title, Close and all three existing actions. Opening/closing the chooser creates no Bot, group, model request or grant.
- Use a controlled React Aria modal with `role="dialog"`, `aria-modal` and a visible labelled heading. Focus Close on open, trap Tab/Shift+Tab within the chooser, and restore the actual opener on Close/Escape. If the keyboard opener no longer exists, fall back to the sidebar New button.
- Preserve current outside-click behavior: the modal is not backdrop-dismissable. Escape during IME composition does not dismiss it. Standard Escape closes the chooser once, without reaching underlying controls.
- Choosing Bot/group closes the chooser and opens the existing editor with its current initial focus. Do not briefly restore focus to the page after the editor takes focus. Cancel returns to the original conversation and its draft, with focus on New; successful submission retains existing destination focus. Preserve existing search clearing on these two actions.
- Import template still calls the existing picker/review flow once. A cancelled native picker returns to New without creating anything; a valid selection enters the existing import review; invalid data keeps the existing error handling. Preserve review's nested preview and cancellation behavior. The modal refactor must not hide this third action.
- Mark the React Aria-owned dialog with `data-focus-owner="react-aria"`. The legacy focus manager looks at the topmost visible dialog. If that dialog has `data-focus-owner`, the manager does not initialize focus, restore focus, or handle keys, including for any legacy dialog underneath it. This is what keeps a closing chooser from fighting a legacy editor that mounts in the same turn. When the topmost dialog has no focus owner, the manager keeps its previous rule: the last non-details dialog, or the details dialog when it is the only one. Legacy destination dialogs keep that manager after the chooser unmounts.
- Retain standard dialog roles used by `readers/HtmlReader.tsx`'s modal observer. An open native HTML/web reader must hide while the chooser or its legacy destination owns interaction, then resume with the same tab, page state, zoom and chat draft. No new reader API is needed.

## 4. Implementation steps

1. Claim the task; reconcile the named pilot against merged main. Capture the baseline pilot and legacy surfaces with the existing isolated harness before changing CSS.
2. Import the pinned file set, record hashes/adaptations/notices, add the four exact dependencies and renderer-only Tailwind configuration. Add the import-boundary check and focused rejection tests.
3. Implement the scoped token/base adapter and local component adaptations. Migrate Language and Appearance, preserving settings ownership and existing error paths.
4. Implement the owned chooser Dialog and migrate its actions. Resolve focus-manager handoff and verify existing native-reader modal detection. Keep destination editors styled as before.
5. Extend the existing acceptance suites below; run full checks after the final relevant edit and inspect the capture matrix. Record evidence and mark `in review` only when acceptance passes. Owner merge determines `done`.

## 5. Acceptance

Every row is required. Test names in quotes describe scenarios to add or extend in the named existing files; they are not claims that tests already exist. Prefer observed focus, state, request counts and geometry over delays or pixel-perfect image equality.

| ID | Observable result | Proof |
| --- | --- | --- |
| A1 | Only the approved MIT source set is imported; original hashes match; actual adaptations and dependency notices are recorded. No Pro/demo/CLI content, remote font or artwork is added. | Source/lockfile review against the pinned revision; check copied BoardUI and bundled dependency license files exist in the built renderer output. Extend the existing notice-copy mechanism for the new runtime dependency closure; build-only tool notices need not be shipped as runtime code. |
| A2 | Frozen dependency install and desktop build succeed with existing project versions; no peer/engine errors or ignored `use client` warnings from the imported files. No new main/preload bundle dependency on these UI libraries. | `pnpm install --frozen-lockfile`, desktop build, bundle/import inspection. Record before/after renderer JS/CSS sizes and explain retained dependency growth; do not mistake the standalone probe's size for product size. |
| A3 | UI primitives cannot import the store, protocol, preload or other application modules; allowed UI/icon imports work. Typography and color classes both survive `cx` merging, including the `ob:` prefix and conflicting spacing classes. | Boundary checker tests for allowed/forbidden static, re-export and dynamic imports; a small desktop unit regression for the typography/color merge pitfall. No weakening of existing rules. |
| A4 | Light remains default under a dark OS; all three modes persist across relaunch; only System follows OS changes; preview/radio state and open popup tokens agree. Drafts survive. | Extend `e2e/chat-interaction.e2e.ts`'s existing appearance test and `e2e/themes.e2e.ts`: OS change while a language popup is open, keyboard radio changes, and return to an unchanged private/group draft. |
| A5 | Settings language selection works with pointer and keyboard, persists after relaunch and updates accessible names. Opening/cancelling does not write; repeated trigger presses do not reopen; scroll remains stable. Names, prompt/memory content and onboarding language behavior remain intact. | Extend `e2e/locale.e2e.ts`; retain native `selectOption` only for onboarding. Use trigger/listbox/option queries for Settings. Assert settings/request effects through the harness, not only visible labels. |
| A6 | Rejected language updates and failed appearance persistence report an error and leave the last confirmed/applied value usable; retry can succeed without a stuck control. | Extend the Settings scenarios in `e2e/chat-interaction.e2e.ts` with one-shot failures at the test bridge/storage boundary; restore the seam before retry. No new production Host endpoint or general fault-injection system. |
| A7 | Pointer and keyboard open one chooser; Tab/Shift+Tab remain inside; Close/Escape restore focus; backdrop press and IME Escape do not close. Bot/group actions hand focus to the legacy editor without a later focus steal, and cancellation preserves the draft. | Add “chooser owns focus and hands off to legacy editors” to `e2e/chat-interaction.e2e.ts`; retain creation assertions in `e2e/groups.e2e.ts` and `e2e/desktop-mvp.e2e.ts`. Count dialogs and check focus after the next rendered frame, not just synchronously in the click handler. |
| A8 | Import template remains present, invokes one picker and handles cancel, valid review and invalid input; nested legacy preview Escape closes only the topmost view. | Extend `e2e/bot-templates.e2e.ts` using its existing `dialog.showOpenDialog` stub and sanitized fixtures. Verify picker cancel restores New and causes no Bot/model activity. |
| A9 | An HTML/web reader never covers the chooser or a destination dialog; closing/cancelling restores the same reader session and unsent chat text. Existing page interaction, resize and tabs still work. | Extend `e2e/files.e2e.ts` using an existing isolated HTML/web fixture with local page state; assert visibility while modal and retained state afterward. Keep existing `artifacts` and `files` regressions. |
| A10 | Imported controls use OpenBot colors/fonts at intended pixel sizes, remain readable and fit the minimum window. Focus/selection remain clear without animation. Legacy chat, approval, Markdown/code and reader surfaces retain their established styling and controls. | Extend `e2e/themes.e2e.ts` with the matrix below; measure text contrast ≥4.5:1 and focus/essential boundary contrast ≥3:1 against actual adjacent surfaces. Inspect screenshots and compare sampled legacy computed colors, typography and geometry to the baseline. Account for alpha/composited colors rather than silently skipping unparseable CSS. |
| A11 | No BoardUI, remote font or remote asset request occurs during startup, pilot use or relaunch. No duplicate React runtime or unrelated app/template dependencies enter the bundle. | Capture renderer requests in the isolated pilot flow (no live embedded website); review emitted dependencies. Existing configured provider/connector traffic is not reclassified or disabled. |
| A12 | All required automated checks pass after the final relevant edit, and no functionality assertions are removed merely because the DOM changed. | `pnpm run check`, full background `pnpm run e2e`, screenshot inspection and `git diff --check`. Refresh shard timings from `e2e/.run/timings.json` when required by AGENTS.md. |

### Capture matrix and geometry

- Capture Settings Appearance, the **open** Language popup and New conversation for English/light, English/dark, Chinese/light and Chinese/dark at 1280 × 800 and the 880 × 560 minimum BrowserWindow size. Record actual viewport dimensions. This is 24 principal captures, which may be produced within existing suites. Do not add a 900 × 650 screenshot matrix in this stage.
- At 900 × 650, verify the same surfaces with DOM geometry rather than pixel diffs: no horizontal document overflow, all chooser actions visible or reachable by internal vertical scrolling, and the language popup inside the viewport.
- Capture keyboard focus and reduced-motion examples. Assert translated labels are not clipped, whole-card radio clicks work, Close has a ≥32 × 32-pixel hit area and the language trigger has at least 36px height. Do not require a particular decorative shadow.
- Capture legacy conversation with formatted Markdown/code, a pending approval and chat with reader in both themes. Reuse the established suites for their underlying data; preserve request/approval behavior, history bounds and safe rendering assertions.
- Keep screenshots/logs under `e2e/.run/`, outside Git. Link their paths and outcomes in the acceptance record. Automated accessibility assertions do not claim a completed VoiceOver audit; native signing, permissions and owner installation remain outside this task.

## 6. Risks and rollback

The primary risks are CSS precedence without Preflight, the 14px root scale, mixed focus ownership and native views above portalled content. The explicit scope marker, pixel-sized tokens and A4/A7/A9/A10 address these directly. React Aria source comments are not proof of correct Electron behavior.

Revert this task's code/dependency changes if the pilot cannot coexist reliably. There is no data-format migration, alternate theme preference or permanent legacy/new switch to unwind. If implementation reveals a required Host/protocol change or restricted source dependency, record a dated finding here and stop that affected work; do not widen the UI pilot silently.

## Open questions

- 2026-11-02: CSS isolation uses `@layer legacy` before `ob-base` and `ob-utilities`, with markers kept for the scoped base and portals. The legacy `!important` rules are scoped and stay in that one layer. Pending confirmation from Yan; if layering proves unsafe in Electron, fall back to selector exclusions.
- 2026-11-02: The legacy focus manager handles a dialog only when it is the topmost visible dialog and it has no `data-focus-owner`. An owned chooser therefore blocks Escape and focus handling for a legacy editor mounted underneath. Pending confirmation from Yan.
- 2026-11-02: Screenshot captures are 1280 × 800 and 880 × 560. The 900 × 650 check stays a DOM geometry assertion. Pending confirmation from Yan.
- 2026-11-02: The import record is `ui/boardui/README.md` (source SHA, original hashes, adaptation reasons). A machine-readable record is deferred because no acceptance check requires one. Pending confirmation from Yan.

## Design-time verification — 2026-11-02

- Resolved Git HEAD and downloaded the exact source revision; inspected the selected imports, helpers, typography, license and absent standalone Modal. Verified original-byte SHA-256 values. Official website snippets differ from this source snapshot, so the snapshot governs the import.
- Used a temporary workspace outside the repository for dependency resolution. Reinstalled with Node `22.22.2` / pnpm `9.12.0`, `--frozen-lockfile --strict-peer-dependencies --ignore-scripts`; the pinned direct dependencies and project React/Vite/types resolved successfully. The product manifest and lockfile were not changed.
- Type-checked the seven selected files under the project's strict options after replacing icon dependencies in the probe. The initial check exposed Select's explicit undefined `items`; the omission adaptation passed without relaxing compiler options.
- Built the adapted subset with Vite `7.3.7` and Tailwind plugin `4.3.3`. Removing renderer-irrelevant client directives cleared the source warnings. Checked prefixed utility output, semantic aliases, pixel typography, absent Preflight reset and preservation of typography/color classes by prefixed tailwind-merge.
- This was a static/type/build probe with a minimal icon stub, not a rendered Electron pilot. It did not test the production icon adapter, focus, native-reader overlays, application CSS coexistence or full workspace dependency graph. A1–A12 remain unexecuted implementation acceptance. The implementation branch must generate and validate the real workspace lockfile and notices.

Documentation validation checks local references, index navigation and whitespace. No product suite is required merely to publish this ready spec.

## Implementation evidence — 2026-11-02

- Local `pnpm run check:quick` passed after `pnpm run build:pi` (lint, boundaries, typecheck). New unit tests for boundaries, focus selection, prefixed `cx`, and license copy passed. Unrelated local-executor and login-shell failures on this Linux agent are outside the pilot.
- Desktop `electron-vite build` succeeded. Renderer JS `index` is 2,286.90 kB and renderer CSS is 108.3 kB. Main and preload bundles do not import the new UI libraries. Copied notices include BoardUI `ui-licenses/boardui/LICENSE`, `react-aria-components@1.17.0`, `react-aria@3.48.0`, and `tailwind-merge@3.6.0`. Tailwind and its Vite plugin stay build-only.
- A headless Chrome comparison of the legacy stylesheets plain versus wrapped in `@layer legacy` found no computed-style difference for button, reader open, appearance card, markdown, approval, or the `pulse` animation. Full Electron screenshot and e2e acceptance still belong to the macOS CI run; this agent cannot compile the macOS keychain helper.

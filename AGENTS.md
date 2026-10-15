# Agent Guide

## Project and Current Phase

OpenBot is an open-source, local-first personal Bot application. The user keeps a roster of named Bots, modeled on Grok Bot's personal features, that all work on the user's own Mac: files, terminal, a managed browser, desktop applications, and connectors. The client, Host Runtime, Pi runtime, local executor, and managed browser all run on that Mac. There is no cloud control plane and no cloud computer. Tools operate a bound execution target; the first release supports only the local target. Model inference uses a configurable endpoint.

Read [the architecture design](docs/architecture.md) before changing module boundaries, protocols, the Pi integration, or the development sequence. [The technical plan](docs/technical-plan.md) records what is implemented, known gaps, and open decisions; [the backlog](docs/backlog.md) lists the next work in batches. Update both when a batch lands. M0 is complete and the M1 path runs end to end as a demo with in-memory approvals and receipts. Implemented packages and apps: `protocol`, `agent-runtime`, `server-core`, `tool-router`, `local-executor`, `apps/local-server` (the Host Runtime), `apps/local-executor`, and `apps/desktop`. `browser` and `computer-use` remain planned. Package boundaries do not imply separate network services or remote pairing.

## Repository Language

- Write repository documentation, code comments, identifiers, user-facing text, and commit or pull request text in English.
- Keep architecture diagrams, examples, and agent instructions in English as well.
- Respond in the user's language in the conversation unless asked otherwise.
- Describe the current design and behavior directly. Keep abandoned proposals and conversational history out of project documentation.

## How Work Happens

OpenBot is built by AI agents. One human owner sets direction. Work splits into two roles:

- **Design** (owner with a design agent): research, trade-offs, architecture, and a written task spec per batch in [`docs/tasks/`](docs/tasks/README.md). Design work changes docs, not product code, unless a spike is needed to settle a question.
- **Execution** (any agent or contributor): implements one task spec end to end. The spec is the contract; follow its steps, contracts, and acceptance. If the spec is wrong or incomplete, stop and note the problem in the spec's **Open questions** instead of improvising a different design.

Execution rules:

- **One task spec per branch and pull request.** Branch name `task/<id>-<slug>`, for example `task/b1-durable-approvals`. The pull request links the spec and lists each acceptance item with how it was checked.
- **Close the loop yourself.** Run `pnpm run check`; run `pnpm run e2e` for anything a user can see or any Host/executor flow; look at the screenshots in `e2e/.run/`. Explore the running app with agent-browser (below) when a flow is new or a test fails. Never hand the owner manual test steps instead of an automated check.
- **Extend the e2e suite with every user-visible behavior.** Script the model with `ScriptedModel` (`e2e/scripted-model.ts`). Real providers are for occasional spot checks only.
- **Commit and push freely** on the task branch with clear English messages, and keep the pull request description current. Do not merge to `main`, force-push shared history, or publish releases; the owner merges.
- **Hand off cleanly:** when the task lands, move it to **Done** in the backlog, add its components to the technical plan's current-state table, and record new gaps or follow-ups.
- Do not add placeholder packages; create a package when its task starts and add its rule to `scripts/check-boundaries.mjs`.

## Driving the App

- `pnpm run dev`: the app with the owner's real data (`~/Library/Application Support/OpenBot`, `~/OpenBot`, `~/.openbot/models.json`).
- `pnpm run dev:debug`: the same, with Chrome DevTools Protocol on port 9339 for agent-browser. Quit any running OpenBot first: the single-instance lock hands a second launch to the first one.
- agent-browser (installed globally; read `agent-browser skills get electron` once): `agent-browser connect 9339`, then `snapshot -i`, `click @eN`, `fill @eN "text"`, `screenshot path.png`. Use it to see and debug; turn every behavior worth keeping into an e2e test.
- `pnpm run e2e`: builds the desktop app and drives it with Playwright against a scripted model, with its own state under `e2e/.run/` (data, workspace, `models.json`, screenshots) and Keychain service `ai.openbot.e2e`. It never touches the owner's data.

## Architecture Boundaries

- Use Bot / Host / Executor / Target vocabulary in product language. Host Runtime owns the agent loop, conversation storage, scheduling, policy, and routines. Desktop provides interaction and application lifecycle. A supervised executor performs authorized operations on a bound `targetId`.
- All Bots share the Mac, the managed-browser profile, the workspace, connectors, and grants. Bots are not a security boundary; do not design features that rely on one Bot hiding data from another.
- Keep application methods in `packages/server-core` and Host process composition in `apps/local-server`. Prefer "Host Runtime" in docs and UI copy; `apps/local-server` is the process entry point name.
- Use Pi Durable only through `packages/agent-runtime`. Keep public OpenBot protocols independent of Pi's internal types and documents.
- Follow the package dependency rules in the architecture document: `tool-router` depends only on `protocol` and reaches application state through ports; `browser` and `computer-use` are used only by `local-executor`; `desktop` depends only on `protocol`.
- Route every model-selected tool through `packages/tool-router`, including host tools. Bind it to an explicit target, evaluate policy before dispatch, and enforce grants again in `packages/local-executor` for executor tools.
- First release: only `{ kind: "local", targetId }` on the Host Mac. Reject non-local targets. Do not implement pairing, LAN or remote transport, or multi-machine UX as a side effect of other work.
- Grants and approvals are always scoped to a `targetId`. Model output cannot forge a target or grant.
- Keep file, command, browser, desktop, and connector adapters behind the executor. Do not install Pi's `CodingTools` or configure an unrestricted Pi environment; neither may bypass OpenBot authorization.
- Use `packages/browser` for the managed browser and `packages/computer-use` for macOS capture and input on the local target. Honor OS permissions, validate coordinates, and require fresh observation after control, takeover, or session changes.
- Policy precedence: hard rules, then Ask first, then Allow automatically, then capability defaults; an optional model reviewer can only make a decision stricter.
- Store credentials in the macOS Keychain, load them in the Host, and redact settings returned to renderers. Exclude credentials from command environments by default; inject connector credentials only into their own connector. Secret values never enter transcripts or model input.
- Persist task acceptance, approvals, dispatch intent, and execution receipts. Preserve stable request and invocation identities; reconcile uncertain side effects before retrying.
- The Host is the sole Pi store owner. The executor owns its separate receipt ledger and never writes the Pi database.
- Follow the first-release limits: one user on macOS, a capped number of parallel Runs with one active Run per conversation, sequential tools within a Run, one desktop control lease at a time, and one selected display for control.
- Closing a window leaves the menu-bar application running. Quitting, locking, sleeping, and restarting require explicit lifecycle handling; they do not imply that an interrupted action completed.
- Keep browser and desktop control visible and pausable. A control lease coordinates OpenBot's own actions on that target and cannot prevent physical user input or constrain arbitrary shell commands to a directory.
- Future remote executors may share the same invoke/cancel/reconcile envelope; do not expand architecture docs into a pairing specification until the local path is accepted.

## Pi Source Vendor

- Keep Pi under `third_party/pi/`, retaining upstream package boundaries and names. Product code belongs in OpenBot modules.
- Resolve the selected Pi packages through the local workspace. Installation, type checking, and runtime builds must agree on package resolution.
- At import time, record provenance in `.openbot-vendor.json`, imported file hashes in `BASELINE.json`, and local patches in `OPENBOT_CHANGES.md`. Preserve upstream licenses and required assets.
- Treat the architecture document's Pi SHA as the proposed initial baseline until an actual import records its source revision.
- Update Pi deliberately using three-way comparison of the old upstream baseline, current OpenBot copy, and new upstream target. Review additions, deletions, conflicts, dependencies, and assets before applying candidates.
- Advance the complete baseline only after the selected import scope has been reviewed and validated. Record selective upstream fixes as local patches without advancing the complete baseline.
- Keep generic runtime patches traceable. Put Bots, grants, policy, execution supervision, browser and desktop control, routines, connectors, UI, and product policy in OpenBot modules.
- Do not synchronize Pi as a side effect of an unrelated task.

## Code and Documentation

- Prefer clear names and explicit module interfaces. Add comments only for non-obvious behavior, constraints, or tradeoffs.
- Keep source facts, design decisions, and unimplemented work distinguishable.
- Update affected architecture or interface documentation when an authorized implementation changes those contracts.
- Preserve provenance, dependency closure, and runtime assets when working with vendored packages.
- Keep credentials, personal data, execution logs, and temporary review artifacts out of the repository.

## Verification

- Commands: `pnpm install`; `pnpm run build:pi` (vendored Pi, once per Pi change); `pnpm run check` (boundaries, type check, unit tests); `pnpm run e2e`; `pnpm run dev` and `pnpm run dev:debug`. Vendored Pi tests run from each package directory with `pnpm exec vitest --run`. CI runs `check` and `e2e` on macOS for every pull request.
- Unit tests protect invariants: authorization, deduplication, recovery, cancellation, ordering, precedence. The e2e suite protects user-visible flows. Do not add tests that only restate wiring.
- Native permissions, signing, and helper identity need a packaged build on a real Mac; say so instead of claiming them verified.
- Report what changed, what ran, and what remains, distinguishing automated checks from real-model spot checks.

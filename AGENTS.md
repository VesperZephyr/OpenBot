# Agent Guide

## Project and Current Phase

OpenBot is an open-source, local-first personal Bot application. The user keeps a roster of named Bots, modeled on Grok Bot's personal features, that all work on the user's own Mac: files, terminal, a managed browser, desktop applications, and connectors. The client, Host Runtime, Pi runtime, local executor, and managed browser all run on that Mac. There is no cloud control plane and no cloud computer. Tools operate a bound execution target; the first release supports only the local target. Model inference uses a configurable endpoint.

Read [the architecture design](docs/architecture.md) before changing module boundaries, protocols, the Pi integration, or the development sequence. [The technical plan](docs/technical-plan.md) records what is implemented, known gaps, the milestone breakdown, and open decisions; update it when a milestone step lands or a decision is made. M0 is complete and the next milestone is M1. Implemented packages and apps: `packages/protocol`, `packages/agent-runtime`, `packages/server-core`, `apps/local-server` (the Host Runtime), and `apps/desktop` (an Electron shell for chat only, built ahead of M2). Other packages and apps in the architecture remain planned until they are actually added. Package boundaries do not imply separate network services or remote pairing.

## Repository Language

- Write repository documentation, code comments, identifiers, user-facing text, and commit or pull request text in English.
- Keep architecture diagrams, examples, and agent instructions in English as well.
- Respond in the user's language in the conversation unless asked otherwise.
- Describe the current design and behavior directly. Keep abandoned proposals and conversational history out of project documentation.

## Working Scope

- Analysis and review requests are read-only. When implementation is requested, make the smallest complete change within the authorized scope.
- Work in the current checkout and preserve unrelated changes. Create worktrees or additional tasks only when requested or necessary for the task.
- Do not add implementation code, copy Pi sources, or create placeholder packages as a side effect of documentation work. Create a package only when the milestone that implements it starts, and add its rule to `scripts/check-boundaries.mjs`.
- Do not commit, push, create pull requests, or publish to external systems unless explicitly requested.
- Ask for clarification only when missing information materially changes the result or risk. Complete independent work while waiting.

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

## Verification and Reporting

- Use commands that actually exist in the repository. Do not invent package scripts or report planned checks as completed.
- Existing commands: `pnpm install`, `pnpm run build:pi` (build vendored Pi in dependency order; required before type checking or tests), `pnpm run check:boundaries`, `pnpm run typecheck` (root project plus `apps/desktop`, which uses bundler resolution), `pnpm run test`, and `pnpm run check` (all three). Desktop: `pnpm --filter @openbot/desktop run dev` and `run build` (electron-vite). Standalone Host: `pnpm --filter @openbot/local-server run start`. Vendored Pi tests run from each package directory with `pnpm exec vitest --run`.
- Process smoke runs set `OPENBOT_DATA_DIR` to a temporary directory and `OPENBOT_KEYCHAIN_SERVICE` to a test service, then delete the test Keychain item. Never write test keys to the default service `ai.openbot.desktop.credentials`.
- Run the smallest checks appropriate to the change. For documentation, check content, links, Markdown structure, and the English-language requirement.
- Prefer existing tests. Add tests only when requested, required by an existing gate, or necessary to protect a high-risk behavior that lacks coverage.
- For runtime changes, verify relevant cancellation, persistence, authorization, and recovery boundaries against the actual workspace or packaged runtime. Native permission and helper behavior require packaged macOS validation. Run broader checks only when the impact or observed failures justify them.
- Report what changed, what was checked, and any remaining limitations. Distinguish static review, simulated checks, and real model or deployment validation.

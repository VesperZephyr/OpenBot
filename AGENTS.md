# Agent Guide

## Project and Current Phase

OpenBot is an open-source desktop agent for personal use. The first release runs the client, Local Server, Pi runtime, and tools on the user's own Mac. Tools operate that local computer; model inference uses a configurable endpoint.

Read [the architecture design](docs/architecture.md) before changing module boundaries, protocols, the Pi integration, or the development sequence. The repository currently contains design documents; application packages, vendored sources, and build commands are planned components until they are actually added. Package boundaries do not imply separate network services.

## Repository Language

- Write repository documentation, code comments, identifiers, user-facing text, and commit or pull request text in English.
- Keep architecture diagrams, examples, and agent instructions in English as well.
- Respond in the user's language in the conversation unless asked otherwise.
- Describe the current design and behavior directly. Keep abandoned proposals and conversational history out of project documentation.

## Working Scope

- Analysis and review requests are read-only. When implementation is requested, make the smallest complete change within the authorized scope.
- Work in the current checkout and preserve unrelated changes. Create worktrees or additional tasks only when requested or necessary for the task.
- Do not add implementation code, copy Pi sources, or create placeholder packages as a side effect of documentation work.
- Do not commit, push, create pull requests, or publish to external systems unless explicitly requested.
- Ask for clarification only when missing information materially changes the result or risk. Complete independent work while waiting.

## Architecture Boundaries

- Local Server hosts the agent loop and owns conversation storage. Desktop provides interaction and application lifecycle; a supervised local executor performs authorized operations.
- Keep application methods in `packages/server-core` and process composition in `apps/local-server`.
- Use Pi Durable through `packages/agent-runtime`. Keep public OpenBot protocols independent of Pi's internal types and documents.
- Route every model-selected tool through `packages/tool-router`. Bind it to the local target and enforce grants again in `packages/local-executor`.
- Keep file and command adapters behind the executor. An unrestricted Pi environment must not bypass OpenBot authorization.
- Use `packages/computer-use` for macOS capture and input. Honor OS permissions, validate display coordinates, and require fresh observation after control or session changes.
- Store credentials in the OS credential store, load them in Local Server, and redact settings returned to renderers. Exclude credentials from command environments by default.
- Persist task acceptance, approvals, dispatch intent, and execution receipts. Preserve stable request and invocation identities; reconcile uncertain side effects before retrying.
- Local Server is the sole Pi store owner. The executor owns its separate receipt ledger and never writes the Pi database.
- Follow the first-release limits: one user on macOS, one active Run, one selected display for control, and sequential tools.
- Closing a window leaves the menu-bar application running. Quitting, locking, sleeping, and restarting require explicit lifecycle handling; they do not imply that an interrupted action completed.
- Keep computer control visible and pausable. A control lease coordinates OpenBot's own actions and cannot prevent physical user input or constrain arbitrary shell commands to a directory.

## Pi Source Vendor

- Keep Pi under `third_party/pi/`, retaining upstream package boundaries and names. Product code belongs in OpenBot modules.
- Resolve the selected Pi packages through the local workspace. Installation, type checking, and runtime builds must agree on package resolution.
- At import time, record provenance in `.openbot-vendor.json`, imported file hashes in `BASELINE.json`, and local patches in `OPENBOT_CHANGES.md`. Preserve upstream licenses and required assets.
- Treat the architecture document's Pi SHA as the proposed initial baseline until an actual import records its source revision.
- Update Pi deliberately using three-way comparison of the old upstream baseline, current OpenBot copy, and new upstream target. Review additions, deletions, conflicts, dependencies, and assets before applying candidates.
- Advance the complete baseline only after the selected import scope has been reviewed and validated. Record selective upstream fixes as local patches without advancing the complete baseline.
- Keep generic runtime patches traceable. Put local grants, execution supervision, computer control, UI, and product policy in OpenBot modules.
- Do not synchronize Pi as a side effect of an unrelated task.

## Code and Documentation

- Prefer clear names and explicit module interfaces. Add comments only for non-obvious behavior, constraints, or tradeoffs.
- Keep source facts, design decisions, and unimplemented work distinguishable.
- Update affected architecture or interface documentation when an authorized implementation changes those contracts.
- Preserve provenance, dependency closure, and runtime assets when working with vendored packages.
- Keep credentials, personal data, execution logs, and temporary review artifacts out of the repository.

## Verification and Reporting

- Use commands that actually exist in the repository. Do not invent package scripts or report planned checks as completed.
- Run the smallest checks appropriate to the change. For documentation, check content, links, Markdown structure, and the English-language requirement.
- Prefer existing tests. Add tests only when requested, required by an existing gate, or necessary to protect a high-risk behavior that lacks coverage.
- For runtime changes, verify relevant cancellation, persistence, authorization, and recovery boundaries against the actual workspace or packaged runtime. Native permission and helper behavior require packaged macOS validation. Run broader checks only when the impact or observed failures justify them.
- Report what changed, what was checked, and any remaining limitations. Distinguish static review, simulated checks, and real model or deployment validation.

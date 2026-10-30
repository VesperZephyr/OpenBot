# Agent Guide

## Start Here

OpenBot is a local-first personal Bot application for one user on macOS. Desktop, Host Runtime, Pi runtime, storage, and the executor run on that Mac; model inference uses a configurable endpoint. There is no cloud control plane or cloud computer. All Bots share the Mac, workspace, connectors, and grants; Bots are not a security boundary.

1. Check the current branch and working tree. Preserve unrelated changes and keep each implementation task on its own branch.
2. Identify the requested work: design, implementation of a ready spec, or a scoped documentation edit. Design changes docs unless a spike is needed; implementation follows the task spec.
3. Read the relevant sources below and any instructions in the directories you will edit. Read the affected code and tests before changing behavior.
4. Implement within scope, verify using the matrix below, and report the result and remaining gaps.

| Source | Read it for |
| --- | --- |
| [Task index](docs/tasks/README.md) → selected spec | The index is navigation; the spec owns task status, contracts, and acceptance |
| [Technical plan](docs/technical-plan.md) | Known gaps, pitfalls, external constraints, and unresolved technical decisions |
| [Backlog](docs/backlog.md) | Active work and next-batch order; planning entries are not ready specs |
| [Architecture](docs/architecture.md) | Module boundaries, protocols, Pi integration, and development sequence; read before changing these |

Read code and tests for implementation details. Keep task status in its spec and evidence there or in a linked dated acceptance record, not in this guide. Managed browser and desktop control are Phase 3 work requiring their own ready specs. Do not expand acceptance work into new capabilities, remote transport, pairing, or multi-machine UX. Package boundaries do not imply separate network services.

## Task Workflow

- **One implementation spec per branch and pull request.** Use `task/<id>-<slug>`. Claim a ready task by setting its status to `in progress`, recording the branch, pushing it, and opening a draft PR linked to the spec. Scoped documentation edits do not require inventing an implementation spec.
- **The spec is the contract.** Follow its scope, steps, contracts, and acceptance. If it is wrong or incomplete, add a dated finding under **Open questions** and stop the affected work; continue independent work. Resolve local implementation choices yourself. Changes to contracts, protocol messages, persistence formats, or user-visible behavior beyond the spec return to design.
- **Close the loop.** Automate acceptance, inspect UI screenshots, and investigate failures. Do not substitute instructions for the owner for checks you can run yourself.
- **Keep delivery state accurate.** Link acceptance evidence from the PR. Passing checks does not mean merged: use `in review` until the owner merges, then mark the spec `done` with the merge reference and remove it from the active backlog. Update other docs only when their decisions, constraints, or gaps change; do not copy test counts or feature summaries across them.
- **Commit and push freely on the task branch.** Keep PR descriptions current. Do not merge to `main`, force-push shared history, or publish releases; the owner merges.

## Architecture and Safety Invariants

Use Bot / Host / Executor / Target vocabulary and prefer **Host Runtime** in docs and UI.

| Location | Responsibility and boundary |
| --- | --- |
| `packages/protocol` | Public contracts independent of Pi internal types and documents |
| `packages/server-core` | Application methods, scheduling, policy, approvals, grants, and routines |
| `packages/agent-runtime` | Sole product adapter to Pi; expose tool invocation through its port |
| `packages/tool-router` | Route every model-selected tool, including Host tools; depends only on `protocol` and accesses application state through ports |
| `packages/local-executor` | Authorized file, command, connector, and future browser/desktop adapters; enforce executor grants again and own the receipt ledger |
| `apps/local-server`, `apps/local-executor` | Host/executor process composition and infrastructure wiring |
| `apps/desktop` | Interaction and application lifecycle; product dependency only on `protocol` |
| Future `packages/browser`, `packages/computer-use` | Managed browser and macOS capture/input; consumed only by `local-executor` |

- **Local target only:** support only `{ kind: "local", targetId }` on the Host Mac and reject non-local targets. Bind every tool, grant, and approval to an explicit target. Model output cannot forge targets or grants.
- **Authorize before dispatch:** hard rules → Ask first → Allow automatically → capability defaults. An optional model reviewer may only make the decision stricter. Do not install Pi's `CodingTools` or configure an unrestricted Pi environment that bypasses OpenBot authorization.
- **Protect credentials:** store them in macOS Keychain, load them in the Host, redact renderer settings, and exclude them from command environments by default. Inject connector credentials only into their connector. Secret values must not enter transcripts or model input.
- **Preserve recovery:** persist task acceptance, approvals, dispatch intent, and execution receipts. Keep stable request/invocation IDs and reconcile uncertain side effects before retrying. The Host alone owns the Pi store; the executor never writes it.
- **Respect concurrency and lifecycle:** cap parallel Runs, allow one active Run per conversation, and execute tools sequentially within a Run. Closing a window leaves the menu-bar app running. Quit, lock, sleep, and restart need explicit handling; interruption is not proof of completion.
- **Future control constraints:** Bots share one managed-browser profile; allow one desktop control lease and one selected display at a time. Honor OS permissions, validate coordinates, keep control visible and pausable, and require fresh observation after control, takeover, or session changes. A lease cannot prevent physical input; a command's working directory cannot confine its filesystem access.
- Create packages only when their task starts; add or verify their dependency rule in `scripts/check-boundaries.mjs`. No placeholder packages.

## Verification

Use the selected spec's acceptance checks in addition to this matrix. Run checks after the final relevant edit; report failures and skipped checks explicitly.

| Change | Required verification |
| --- | --- |
| Documentation only, with no runtime/build impact | Check facts, referenced paths, and links; run `git diff --check`. Product suites are unnecessary unless the spec requires them |
| Product code, dependencies, or build configuration | `pnpm run check` (boundaries, type checking, unit tests) |
| User-visible behavior or any Host/executor flow | Also run `pnpm run e2e` and inspect relevant screenshots in `e2e/.run/` |
| Vendored Pi | Also run `pnpm run build:pi` and affected upstream tests with `pnpm exec vitest --run` from their package directories |
| Native permissions, signing, or helper identity | A packaged build on a real Mac; automated background checks alone do not establish these claims |

- Extend e2e coverage for every added or changed user-visible behavior. Use `ScriptedModel` in `e2e/scripted-model.ts`; real providers are occasional spot checks, not deterministic acceptance.
- Call Host methods through `h.api()`, wait for rendering with `h.nextFrame()`, and advance scheduled routines with `h.advanceHostClockTo()`. Prefer observed signals over fixed `waitForTimeout` delays.
- Unit tests protect authorization, deduplication, recovery, cancellation, ordering, and precedence. Avoid tests that only restate wiring.
- After adding an e2e suite or noticeably changing its duration, refresh shard timings from a full run: `node scripts/e2e-shard.ts --record e2e/.run/results.json`. CI runs `check` and `e2e` on macOS for each PR.

### Isolated App Verification

- `pnpm run e2e` builds and drives Electron with Playwright, isolated state under `e2e/.run/`, and a checkout-specific Keychain service (`ai.openbot.e2e.<hash>`). It does not touch owner data.
- Keep verification in background mode: hidden, non-focusable windows with no notifications, Dock badges, tray, or power assertions. Screenshots still render. Use `pnpm run e2e:headed` only when visible windows are explicitly requested.
- Explore new flows or failing tests with agent-browser in an isolated background test app. Read `agent-browser skills get electron` once, connect to that app's CDP port, then use `snapshot -i`, `click @eN`, `fill @eN "text"`, and `screenshot path.png`. Convert useful findings into e2e checks.
- `pnpm run dev` and `pnpm run dev:debug` use **owner data**: `~/Library/Application Support/OpenBot`, `~/OpenBot`, and `~/.openbot/models.json`. Do not launch them as a verification side effect. Debug mode exposes CDP on port 9339; a running instance receives a second launch because of the single-instance lock.

### Setup and Packaging

- Install dependencies with `pnpm install`. Under `CI=true`, installation uses a frozen lockfile; after adding a dependency, use `pnpm install --no-frozen-lockfile` and include `pnpm-lock.yaml`.
- Build vendored Pi with `pnpm run build:pi` on initial setup and after Pi changes. Installation, type checking, and runtime builds must resolve the same local workspace packages.
- `pnpm run package` creates an arm64 DMG, ad-hoc signed when no Developer ID is configured. Distinguish automated checks, real-model spot checks, and native packaged evidence in the handoff.

## Pi Maintenance

- Keep upstream boundaries, names, licenses, dependency closure, and runtime assets under `third_party/pi/`. Product behavior belongs in OpenBot modules; generic runtime patches remain traceable in Pi.
- Read `third_party/pi/.openbot-vendor.json` for actual import provenance, `BASELINE.json` for imported file hashes, and `OPENBOT_CHANGES.md` for local patches. Update the patch ledger when changing vendor files. The architecture's proposed SHA does not override the recorded import.
- Synchronization is deliberate work: follow architecture Sections 2.3–2.4 and compare old upstream baseline, current OpenBot copy, and exact new upstream revision. Review additions, deletions, conflicts, dependencies, and assets before applying candidates.
- Advance the complete baseline only after the selected import scope is fully reviewed and validated. Record selective upstream fixes as local patches without advancing it. Never synchronize Pi as a side effect of another task.

## Documentation, Comments, and Enforced Rules

Record information that cannot be recovered cheaply from code: decision rationale and reconsideration triggers, external constraints, compatibility promises, operational recovery, known gaps, and non-obvious pitfalls or hacks. Do not maintain prose copies of function behavior, type definitions, call graphs, or completed implementation steps. Before implementation, specs may define new contracts; afterward, treat their design and evidence as dated records, not a second API reference.

- **One maintained home per fact.** Architecture owns lasting design decisions and trust boundaries; specs own task status and acceptance; backlog owns the active queue; technical plan owns cross-cutting gaps and pitfalls. The task index only links specs. The roadmap preserves planning rationale; dated research and acceptance records preserve evidence. Link to the owner instead of repeating its contents.
- **Keep decisions useful.** Record the choice, reason, constraints, and conditions for revisiting it. Retain rejected alternatives only when they explain a trade-off or prevent repeating a costly investigation; omit discussion transcripts.
- **Record pitfalls and hacks where they matter.** Capture trigger/symptom, root cause, workaround, regression test or evidence, and removal condition. Put a local exception beside the code; use the technical plan for cross-cutting issues and vendor ledgers for Pi patches. Add a regression test when reproducible. Do not create a second incident write-up when the test and a short explanation preserve everything useful.
- **Default to no comments.** Use clear names and interfaces. Comments are for non-obvious reasons, external limitations, compatibility constraints, and temporary workarounds that code cannot express. Keep a hack's reason and removal condition adjacent to it, linking longer evidence if needed. Avoid narration, redundant docstrings, and unexplained TODOs; preserve required license/provenance notices.
- **Enforce mechanically checkable rules in tooling.** Use lint/static checks for imports, forbidden APIs, and mechanical conventions; types/schema checks for contracts; unit/integration tests for authorization, ordering, deduplication, and recovery; e2e for user flows. A prose rule is not enforcement. Add or extend the appropriate check with an authorized implementation, wire it into CI, and make failures identify the violation and remedy. Do not build lint rules for subjective comment quality or weaken checks to silence a failure.
- **Describe existing enforcement accurately.** [Package scripts](package.json), the [boundary checker](scripts/check-boundaries.mjs), and [CI workflow](.github/workflows/ci.yml) define current checks. There is no standalone lint command today; a proposed rule is not enforced until its check exists. Keep commands in scripts, with docs explaining prerequisites and recovery rather than duplicating script internals.

## Writing and Repository Hygiene

- Write repository docs, comments, identifiers, diagrams, examples, agent instructions, and commit/PR text in English. Use English for new UI copy and maintain the existing localization conventions. Keep `README.md` and its owner-requested Chinese translation `README.zh-CN.md` aligned when changing shared content. Respond in the user's language.
- Describe current behavior directly; distinguish implemented facts, design decisions, and planned work. Keep conversational history out of maintained project docs. Update affected architecture/interface docs when authorized changes alter contracts.
- Keep credentials, personal data, execution logs, and temporary review artifacts out of the repository.
- End with what changed, what verification ran and its outcome, and what remains unverified or blocked.

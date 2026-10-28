# OpenBot Architecture

Status: first-release design baseline. Last updated: 2026-10-27.

This document defines the target product shape, repository layout, module boundaries, interfaces, source dependencies, and development sequence. M0 is complete; the Host Runtime and a chat-only desktop shell exist ahead of their milestones. [The technical plan](technical-plan.md) tracks which parts are implemented and how each milestone is broken down; everything else below requires implementation and validation.

OpenBot is local-first. There is no cloud control plane and no cloud computer. The desktop UI, Host Runtime, Pi agent loop, storage, managed browser, and local executor all run on the user's Mac. Model inference and optional web search may call configurable API endpoints; that choice is separate from where OpenBot itself runs.

## 1. Product Goals and Runtime Scope

OpenBot gives one user a roster of persistent, named **Bots**: AI teammates with a role, instructions, memory, skills, and routines. The user messages a Bot with a task; the Bot works across files, the terminal, a browser, desktop applications, and connected services on the user's own Mac, keeps the user updated in the conversation, and stops for approval when an action needs it.

The product model follows Grok Bot's personal features, with every cloud component replaced by a local one. All Bots share the user's Mac as their computer.

| Grok Bot concept | OpenBot local equivalent |
| --- | --- |
| Persistent cloud computer per account | The user's Mac, shared by every Bot through the local executor |
| Shared browser sessions across Bots, one screen per Bot | One OpenBot-managed browser profile with shared logins; one browser window per Bot |
| `/workspace` shared files | A default shared workspace folder plus user-granted directories |
| Desktop and mobile clients with cloud sync | The macOS desktop application only |
| Work continues while the laptop is closed | Work continues while the window is closed and the Mac is awake; sleep suspends work and wake reconciles it |
| Connectors installed as plugins | MCP servers supervised by the local executor |
| Skills, teach-by-demonstration, routines | A local skill library, managed-browser recordings, and a local routine scheduler |
| Auto Review, Ask first / Allow automatically, takeover, secure secret requests | Local policy rules, an optional model reviewer, browser and desktop takeover, and Keychain-backed secret entry |
| Group chats and Bot-to-Bot handoff | Local group conversations and routed handoff messages between Bot conversations |

| Term | Meaning |
| --- | --- |
| Bot | A named profile (role, instructions, model, tool families, memory) with its own conversation; Bots are not a security boundary |
| Host | Owns Bots, conversations, the Pi Durable store, scheduling, approvals, policy, grants, routines, and tool routing |
| Executor | Performs authorized side effects on its bound target and keeps its own receipt ledger; never writes the Pi database |
| Target | The bound execution destination; the first release has exactly one: `{ kind: "local", targetId }`, this Mac |
| Grant | A user decision recorded as `(targetId, capability, scope, version)`; shared by all Bots |
| Policy rule | A persisted Ask first or Allow automatically rule evaluated before dispatch |
| Control lease | The exclusive, visible right for one Bot to send keyboard and mouse input to the real desktop, with an epoch |
| Skill | Reusable written instructions shared by all Bots |
| Routine | A Bot-owned schedule that runs a workflow without the user starting it |
| Connector | An MCP server that exposes structured tools for a service |

| Area | First-release decision |
| --- | --- |
| User and platform | One user on their own Mac; macOS first |
| Client | Electron + React, with a narrow preload API and a menu-bar presence |
| Host | A Host Runtime process managed by the desktop application (process composition lives in `apps/local-server`) |
| Agent | Pi Durable embedded in the Host through an OpenBot runtime adapter; one Pi conversation per Bot thread |
| Execution target | Only the local target: this Mac, its files, processes, managed browser, and interactive desktop session |
| Concurrency | Several Bots run in parallel up to a configurable cap; one active Run per conversation; sequential tools within a Run; one desktop control lease at a time |
| Model configuration | Configurable provider, model, base URL, and credentials per Bot; image input is required for visual browser and desktop observation |
| Persistence | Local SQLite, application artifacts, and files in user-authorized directories |
| Distribution | One desktop application bundling its required runtime and helpers |

Local execution and model inference are separate choices. Relevant conversation content, selected file content, browser snapshots, and screenshots can be sent to the configured provider as model input. A compatible local model endpoint can be configured; fully offline operation is not a first-release acceptance requirement.

### 1.1 Trust Model

All Bots share one computer, one browser profile, one workspace, and one set of grants, exactly as all of a user's Grok Bots share one computer. A Bot's description can state boundaries, but Bots do not isolate data or authority from each other. Policy rules can be narrowed to a Bot; grants cannot be relied on to keep a secret from another Bot.

The executor and every command it starts run as the user. Process boundaries between programs running as the same user are not an OS sandbox. A shell command's working directory does not confine its filesystem access, and a desktop application can open files outside a file grant. OpenBot therefore authorizes file tools, commands, browser control, desktop control, and connectors as separate capabilities, and keeps every grant and approval scoped to the target.

The first release has no isolated execution environment. An isolated environment, such as a local virtual machine, would attach later as a separate target behind the same Tool Router and executor protocol.

### 1.2 Multi-Target Seam (not first-release work)

The protocol carries `targetId` everywhere so that another execution destination can attach later without rewriting the agent loop. A future target runs only an executor; it never hosts Pi or conversation storage.

First-release rule: only `kind: "local"` is implemented. There is no pairing UI, LAN or remote transport, second-machine UX, or remote authentication. Tool Router rejects any other `targetId`. Do not expand this document into a pairing or remote-transport specification until the local path is accepted.

Out of scope for the first release: cloud control plane, cloud computer, mobile clients, multi-device sync, multi-user hosting, and peer-to-peer OpenBot instances on several machines.

## 2. Relationship with Pi

### 2.1 Source Vendoring

OpenBot vendors the required Pi sources under `third_party/pi/`, builds them within the local workspace, and accesses them only through `packages/agent-runtime`. This allows direct maintenance of task recovery, tool execution boundaries, and scheduling while retaining traceable upstream provenance and supporting deliberate manual updates.

Source distribution and runtime integration are separate concerns. Vendored code still exposes explicit package interfaces. OpenBot product code and Pi internals remain separate so upstream changes can be compared without losing local modifications.

### 2.2 Source Baseline and Import Scope

The reviewed upstream is [earendil-works/pi](https://github.com/earendil-works/pi) at [`b45e0ebcc5ae2fc42a6f2f23104d10e656e6bedb`](https://github.com/earendil-works/pi/tree/b45e0ebcc5ae2fc42a6f2f23104d10e656e6bedb) (2026-10-14). Its package version is 1.2.0, and the revision is 44 commits ahead of the `v1.2.0` release tag. This exact SHA is the proposed initial import baseline. Record the actual imported contents and avoid following a floating `main` during builds.

| Upstream directory | Package | Role in OpenBot |
| --- | --- | --- |
| `packages/durable` | `@earendil-works/pi-durable` | Persistent conversations, model generation, tool tasks, compaction, documents, state observation, and recovery |
| `packages/ai` | `@earendil-works/pi-ai` | Providers, credential resolution, model requests, streaming responses, and message/tool formats |
| `packages/chord` | `@earendil-works/chord` | Context, cancellation, state, and document infrastructure used by Durable |
| `packages/codemode` | `@earendil-works/pi-codemode` | Core-only local application orchestration through the agent-runtime adapter (B25/B26) |
| `packages/telemetry` | `@earendil-works/pi-telemetry` | Telemetry contracts required by `pi-ai` |

The dependency graph is `durable -> ai / chord / codemode`, with `ai -> telemetry`. The initial import excludes `pi-agent-core`, `pi-coding-agent`, and the TUI. All five packages declare `engines.node >= 22.19.0`. See the [Durable manifest](https://github.com/earendil-works/pi/blob/b45e0ebcc5ae2fc42a6f2f23104d10e656e6bedb/packages/durable/package.json) and [AI manifest](https://github.com/earendil-works/pi/blob/b45e0ebcc5ae2fc42a6f2f23104d10e656e6bedb/packages/ai/package.json).

Import the selected packages' sources, relevant existing tests, manifests, required shared build configuration, and runtime assets. Copying only `src` does not complete an import. In particular:

- Upstream does not commit `pi-ai` model data: `packages/ai/src/providers/data/` is ignored by Git and produced by the networked `generate-models` script from public catalogs. Generate it with the baseline revision's `hydrate-model-data` script at import time, vendor the generated files with their own hashes in `BASELINE.json`, and build with `build:offline`, which validates the data before compiling. Local and packaged builds then need no network access. Do not hydrate from upstream's Nix catalog pin unless `pi-ai`'s tests pass against it; a pin older than the revision's generator fails metadata tests.
- Durable's Node image processor loads Photon's `photon_rs_bg.wasm` from `@silvia-odwyer/photon`, and Code Mode depends on `quickjs-wasi`. Package both WebAssembly assets.
- External dependencies remain managed and locked by the package manager.

### 2.3 Maintenance Boundaries

Keep the upstream `packages/<name>` layout and internal package names under `third_party/pi/`. Resolve Pi packages to the vendored sources through the pnpm workspace (Section 4.3). Installation, type checking, and runtime builds must resolve consistent entry points and must not mix in another registry copy of Pi.

Create these provenance records during the actual import:

| Path | Responsibility |
| --- | --- |
| `third_party/pi/.openbot-vendor.json` | Upstream URL, ref, exact SHA, package version, import date, package scope, and asset provenance; the machine-readable baseline entry point |
| `third_party/pi/BASELINE.json` | Imported file inventory, upstream paths, and original content hashes; also record adapted hashes when mechanical transformations are required |
| `third_party/pi/OPENBOT_CHANGES.md` | Local patch IDs, reasons, affected files, related upstream commits, and validation; reconcile this ledger with the actual baseline diff |
| `third_party/pi/LICENSE` | Pi's license and copyright notice; retain separate notices for third-party assets |

The baseline inventory describes the imported source. Update the patch ledger when changing vendor files, and advance the baseline only after a complete synchronization has passed validation. See [Pi's license](https://github.com/earendil-works/pi/blob/b45e0ebcc5ae2fc42a6f2f23104d10e656e6bedb/LICENSE).

Apply changes according to these boundaries:

- Keep generic agent-loop, durable-task, and storage changes in the Pi source copy as independently traceable patches.
- Keep Bots, grants, policy, approvals, execution supervision, browser and desktop control, routines, connectors, UI, and product protocols in OpenBot modules.
- Encapsulate Pi types in `agent-runtime`. Host IPC, executor protocols, and clients do not depend on Pi's internal document structure.
- Review updates against exact SHAs, reconcile patches, validate affected existing tests and OpenBot integration scenarios, then advance the baseline. Storage changes require backup, migration, and rollback compatibility checks.

Pi Durable declares its API experimental. Source vendoring lets OpenBot control its compatibility schedule; product protocols still require independent versioning. See the [upstream notice](https://github.com/earendil-works/pi/blob/b45e0ebcc5ae2fc42a6f2f23104d10e656e6bedb/packages/durable/README.md).

### 2.4 Manual Synchronization

Each synchronization is a three-way comparison of A, the old upstream baseline; B, the new upstream revision; and C, OpenBot's current copy. Review and application remain manual in the first release; a later helper may generate candidates and reports.

1. Ensure current vendor changes are organized and traceable. Read the old SHA and import scope from `.openbot-vendor.json`, fetch the target revision in a separate Pi checkout, and resolve it to an exact SHA.
2. Review relevant commits, changed files, package dependencies, exports, storage formats, and runtime assets between the old and new revisions. Review new dependencies recursively; updating only `durable/src` is insufficient.
3. Extract A and B from Git objects rather than a possibly modified Pi working directory. Apply the same path mappings and mechanical transformations used for C.
4. Generate merge candidates outside the repository. Review overlapping changes, additions, deletions, renames, binary files, and file-mode changes individually. Candidate generation neither overwrites current sources nor advances the baseline.
5. Apply selected changes and reconcile `OPENBOT_CHANGES.md`: retain necessary patches, mark patches superseded by upstream, and record new adaptations. Update dependency locks, build configuration, and asset inventories as needed.
6. Verify local package resolution, types, and builds. Run affected existing upstream tests and OpenBot integration checks. Storage changes require checks for opening old data, migration, recovery, and rollback constraints.
7. Update the baseline SHA, file inventory, and patch status only after the entire selected scope has been reviewed and validated. Keep the old baseline and record outstanding work if synchronization is incomplete.

When importing a single upstream fix, record its source commit as a local patch and retain the complete baseline. Every synchronized state must be explainable as one exact baseline plus a traceable set of local changes.

## 3. Local Deployment and Process Boundaries

```mermaid
flowchart TB
  subgraph mac [User Mac]
    subgraph Desktop [Electron Application]
      UI[React Renderer]
      MAIN[Main Process Preload Menu Bar Notifications]
      UI <-->|Typed IPC| MAIN
    end
    subgraph HostProc [Host Runtime Process]
      CORE[Server Core Bots Scheduling Policy Routines]
      RT[Agent Runtime Pi Durable]
      TR[Tool Router]
      HT[Host Tool Handlers Memory Skills Web Handoff]
      CORE <--> RT
      RT <--> TR
      TR <--> HT
    end
    subgraph Worker [Local Executor Process]
      EX[Invocation Supervisor Receipt Ledger]
      ENV[File and Command Adapter]
      BR[Managed Browser Adapter]
      CU[Computer Use Adapter]
      MCP[Connector Supervisor]
      EX <--> ENV
      EX <--> BR
      EX <--> CU
      EX <--> MCP
    end
    DB[(Pi SQLite and OpenBot Documents)]
    ART[(Artifacts)]
    RECEIPTS[(Executor Receipts)]
    KC[(macOS Keychain)]
    FILES[Workspace User Files Processes]
    CHROME[Managed Chromium Profile]
    SCREEN[Desktop Applications]
    SERVERS[MCP Server Processes]
    MAIN <-->|Private IPC| CORE
    TR <-->|Private IPC| EX
    RT <--> DB
    CORE <--> ART
    MAIN <--> KC
    EX <--> RECEIPTS
    ENV <--> FILES
    BR <-->|CDP over pipe| CHROME
    CU <--> SCREEN
    MCP <--> SERVERS
  end
  RT <-->|Model Requests| MODEL[Configured Model Endpoint]
  HT <-->|Optional| SEARCH[Configured Search Endpoint]
```

There are three OpenBot processes, plus a computer-use helper: Desktop (Electron), Host Runtime, and the local executor. Desktop main starts the Host and connects through the child's IPC file descriptor. The Host starts the executor the same way and owns that connection. The executor is a separate process so that a command, browser, native helper, or connector failure can be contained and reconciled independently of the UI and conversation store. No OpenBot process opens a listening socket in the first release.

The Host and executor run on a **bundled, pinned, signed Node 24 binary** started with `child_process.spawn`, not on Electron's embedded Node:

- Electron's `runAsNode` fuse is disabled (Section 6.4), and with it disabled `child_process.fork` from Electron throws. `utilityProcess` can only be created from Electron main, so the Host could not start the executor from inside one.
- The same Node runs development, the M1 harness, Pi's tests, and the packaged app, and Pi's Node version is independent of Electron's release cycle.
- Process exit codes, signals, and process-group termination keep ordinary POSIX semantics.
- Cost: one more Mach-O per architecture, signed with the hardened runtime and the `com.apple.security.cs.allow-jit` entitlement; without it, the hardened runtime kills V8 at startup.

Streams between processes need application-level backpressure: neither Node IPC nor `MessagePort` applies flow control. Desktop observation uses pull credit: one bounded invalidation response per pending request, followed by current-state reads before granting another credit. The Host coalesces changes by topic instead of buffering event payloads.

The renderer uses an allowlisted preload API; it cannot launch processes, open the database, read credentials, or connect directly to the Host or executor.

Only one Host owns the Pi store. Enforce a single application instance and exclusive store ownership before opening the database, including during crash recovery. Pi itself provides no cross-process store lock. The executor owns a separate receipt ledger and never writes the Pi database. See [Pi storage constraints](https://github.com/earendil-works/pi/blob/b45e0ebcc5ae2fc42a6f2f23104d10e656e6bedb/packages/durable/README.md#storage).

Pi's Node SQLite adapter uses `node:sqlite`; verify it in the packaged application as well as the development checkout. Desktop packaging must include the selected Pi packages, their runtime assets, the Node binary, and native helpers. The Host's and executor's JavaScript lives outside `app.asar` because the standalone Node cannot read ASAR archives; it is still covered by the application's code signature.

## 4. Repository Layout and Module Boundaries

### 4.1 Layout

OpenBot is a pnpm workspace TypeScript monorepo. Package boundaries follow Host / Executor / Target responsibilities and do not imply separate network services.

```text
OpenBot/
  apps/
    desktop/          # Electron main, preload, and React renderer
    local-server/     # Host Runtime entry: composition, credential broker, IPC transport, startup recovery
    local-executor/   # Executor process entry: adapters, browser, native helper, connector processes
  packages/
    protocol/         # Versioned IPC and execution envelopes including targetId; data contracts only
    server-core/      # Bots, conversations, scheduling, policy and approvals, grants, routines, skills, settings
    agent-runtime/    # The only product package that imports Pi
    tool-router/      # Target validation, dispatch gates, policy checkpoint, dispatch intent, correlation
    local-executor/   # Invocation supervision, receipt ledger, file and command adapters, connector supervisor
    browser/          # Managed Chromium profile, per-Bot windows, snapshots, input, takeover
    computer-use/     # macOS permissions, capture, input, display coordinates; native helper under native/
  third_party/
    pi/               # Vendored Pi with upstream packages/* names and layout
  docs/
  AGENTS.md
  pnpm-workspace.yaml
  package.json
  tsconfig.base.json
```

Product packages are published within the workspace as `@openbot/*`. Pi packages keep their `@earendil-works/*` names. Create a package only when a milestone implements it; do not add placeholder packages.

| Module | Responsibility | Boundary |
| --- | --- | --- |
| `apps/desktop` | Bot roster, conversations, group chats, streamed output, approval and takeover cards, settings, notifications, menu bar, and application lifecycle | Depends only on `protocol` |
| `apps/local-server` | Compose the Host: own the store, wire ports, implement the private credential adapter, bind IPC, supervise the executor, and run startup recovery | Process entry point; little product logic |
| `apps/local-executor` | Compose executor adapters, bind the parent IPC channel, and own child processes and the browser instance | Process entry point |
| `packages/protocol` | Requests, responses, events, errors, execution envelopes, and one TypeBox parameter schema per Host method | No Pi, Electron, or Node-specific implementation dependencies; TypeBox is its only dependency |
| `packages/server-core` | Transport-independent application methods, scheduling, policy evaluation, approvals, grants, routines, skill library, Bot memory, and host tool handlers | Defines `SecretStore` and other infrastructure ports |
| `packages/agent-runtime` | Wrap Pi, map Bots to Pi conversations, register product tools, project state, coordinate cancellation and recovery | Defines the `ToolInvoker` port that every tool call enters |
| `packages/tool-router` | Validate target and capability, consult policy, gate scheduling, persist dispatch intent, dispatch to the executor or a host handler, and correlate results | Defines `PolicyPort`, `DispatchLedger`, `ExecutorTransport`, and `HostToolHandler` ports |
| `packages/local-executor` | Execute file, command, browser, desktop, and connector invocations; enforce grants again; keep receipts | Executor protocol |
| `packages/browser` | Launch and drive the managed browser profile, map Bots to windows, capture snapshots, and handle takeover | Called only by `local-executor` |
| `packages/computer-use` | macOS permission checks, screenshot capture, application activation, keyboard and mouse input, and display coordinates | Called only by `local-executor` |
| `third_party/pi` | Vendored Pi sources, assets, provenance, and local patch records | Consumed only by `agent-runtime` |

### 4.2 Dependency Rules

```mermaid
flowchart BT
  protocol[protocol]
  pi[third_party/pi]
  agentRuntime[agent-runtime]
  toolRouter[tool-router]
  serverCore[server-core]
  localExec[local-executor]
  browser[browser]
  computerUse[computer-use]
  hostApp[apps/local-server]
  execApp[apps/local-executor]
  deskApp[apps/desktop]

  agentRuntime --> protocol
  agentRuntime --> pi
  toolRouter --> protocol
  serverCore --> protocol
  serverCore --> agentRuntime
  localExec --> protocol
  localExec --> browser
  localExec --> computerUse
  hostApp --> serverCore
  hostApp --> agentRuntime
  hostApp --> toolRouter
  execApp --> localExec
  deskApp --> protocol
```

- Dependencies point downward only. `desktop` never depends on `server-core`, `agent-runtime`, or Pi. `local-executor` never depends on `server-core`, `tool-router`, or Pi.
- Only `agent-runtime` imports `third_party/pi`.
- `tool-router` depends only on `protocol`. It reaches grants, policy, approvals, and the dispatch ledger through ports that `apps/local-server` wires to `server-core`. `agent-runtime` reaches the router only through its own `ToolInvoker` port. This keeps the router from importing application logic and avoids a cycle between the runtime, the router, and the application layer.
- `browser` and `computer-use` are imported only by `local-executor`.
- Concrete Keychain, IPC, and process-spawning implementations live in `apps/*`; packages define the ports.
- Both Host↔Desktop and Host↔Executor traffic uses `protocol` envelopes, so a future executor transport changes no business package.

Enforce these rules with an import-boundary check in CI rather than convention.

### 4.3 Workspace Configuration

List the vendored Pi packages explicitly so that an unreviewed upstream package never joins the build:

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "third_party/pi/packages/durable"
  - "third_party/pi/packages/ai"
  - "third_party/pi/packages/chord"
  - "third_party/pi/packages/codemode"
  - "third_party/pi/packages/telemetry"
```

- Product packages depend on Pi with `workspace:*`.
- Upstream Pi manifests pin each other with exact versions such as `"1.2.0"`, not `workspace:*`. `.npmrc` enables `link-workspace-packages` and `prefer-workspace-packages` so those specifiers link to the vendored packages. Verify that `pnpm-lock.yaml` resolves every `@earendil-works/*` package as a workspace link, never from a registry.
- Pi packages resolve to their built `dist` for both type checking and runtime: `pnpm run build:pi` builds them in dependency order, and product packages then type-check and run against the same output. Durable, Chord, and Code Mode also expose a `source` condition, but AI and Telemetry do not, so OpenBot does not use it.
- pnpm's strict layout exposes undeclared imports that upstream npm hoisting hides. Record each workaround as a workspace adaptation in `OPENBOT_CHANGES.md` (currently `@smithy/types` for `pi-ai`).
- `pnpm run check:boundaries` enforces Section 4.2 for every manifest and source import under `apps/` and `packages/`; a new package must add its rule to `scripts/check-boundaries.mjs`.

## 5. Runtime Integration

### 5.1 Agent Runtime and Pi Mapping

Pi runs inside the Host. One Pi `Harness` opens the store and runs every Bot's conversations concurrently. Before scheduling, the Host assembles the model collection, storage, extension registry, OpenBot tool definitions, and settings.

| OpenBot concept | Pi integration point | Contract |
| --- | --- | --- |
| Bot thread | `harness.createConversation({ ownership: { kind: "ownerless" } })` | One direct conversation per Bot; additional conversations are mapped by `(botId, channelId)`; record workspace and local-target binding in OpenBot documents |
| Bot profile | `conversation.configure({ model, thinkingLevel, instructions, extensions, tools, modelTools, cwd })` | Applied when the profile changes; takes effect from the next model request |
| Start work | `conversation.submit({ type: "input", content, requestId, entry })` | Stable Pi request ID derived from the OpenBot request ID; OpenBot entry kinds use the `openbot.` prefix |
| Steer a running Bot | `submit({ ..., whenBusy: "steer" })` | A user message to a Bot with an active Run joins that Run at the next tool boundary; routine and handoff input waits in the OpenBot queue instead |
| Non-model transcript records | `submit({ type: "write", entry })` | Routine reports, handoff notices, and group messages that should not start a model request |
| New topic or handoff | `conversation.reset(handoff)` | Older entries remain in storage |
| Observe | `conversation.watch()`, `viewState()`, or `watchEvents()` | Project Pi state into OpenBot snapshots and sequenced events |
| Register tools | `defineExtension()`, `defineTool()` | Every product tool calls the `ToolInvoker` port with a bound `targetId` |
| Connector tools | `deferred: true` plus `createToolSearchExtension()` | Large tool sets are searched and loaded on demand |
| Product state | `defineDoc()` with `session` or `conversation` scope | Bots, queues, policy, grants, routines, invocation records, and memory |
| Cancel | `conversation.abort()` | Also cancel executor work and reconcile the outcome |
| Usage | `docs["pi.usage"]`, `harness.usage()` | Per-Bot and total token and cost display |
| Recover | Reopen storage and gate scheduling before `harness.resume()` | Reconcile unfinished invocations and invalidate stale browser and desktop control first |

Required Harness settings:

- `toolExecution: "sequential"`, so Pi itself runs one tool at a time within a round. Tool Router enforces the same rule as a second gate.
- `env` is not configured, and `CodingTools` is not installed. Pi's built-in `read`, `write`, `edit`, and `bash` would otherwise act through an unrestricted environment and bypass OpenBot authorization. Reusing them later requires a routed `ExecutionEnv` that preserves authorization and supervision. See the [environment API](https://github.com/earendil-works/pi/blob/b45e0ebcc5ae2fc42a6f2f23104d10e656e6bedb/packages/durable/README.md#environment).
- The model collection is created with `createModels({ credentials })`, where `credentials` is a Keychain-backed `CredentialStore` (Section 5.9).

A Pi tool receives `execute(args, api, context)`, including conversation, task, and call identities. The adapter derives a stable OpenBot `invocationId` from the Pi tool task, propagates cancellation, and converts results into model text or image content. See the [Pi tool interface](https://github.com/earendil-works/pi/blob/b45e0ebcc5ae2fc42a6f2f23104d10e656e6bedb/packages/durable/src/harness/types.ts).

**Replay policy.** Every routed tool is declared `replay: "safe"` at the Pi layer. This is correct only because the routed adapter, not the tool body, owns idempotency:

- The `invocationId` is the same on every rerun of the same Pi tool task.
- If the invocation record shows it still waiting for approval, the rerun resumes waiting; the approval survives a Host restart.
- If dispatch intent exists, the rerun re-sends the same `tool.invoke`. The executor deduplicates by `invocationId` and argument digest: it either accepts a never-received invocation once or returns the recorded state.
- If the executor recorded acceptance but has no terminal receipt, the outcome is `unknown`; the adapter returns an `unknown` error result and the Run enters `needs_attention`. It never dispatches a new invocation in its place.

A tool that cannot satisfy these rules must stay `replay: "unsafe"`, which makes Pi return an interrupted result after a crash. See [Pi tool recovery](https://github.com/earendil-works/pi/blob/b45e0ebcc5ae2fc42a6f2f23104d10e656e6bedb/packages/durable/README.md#tools).

**Durable command completion (B15b).** Tool Router reserves Host-owned completion tracking before an authorized local command starts and binds a returned background task before its tool result commits. Only live user/peer Runs can subscribe. Executor terminal receipts atomically retain trusted source identity and at most 16 KiB of UTF-8 output; legacy tasks never wake a Bot. A target-bound private inspection request reads up to 16 known identities with one request in flight. Host copies the receipt before stable queue admission and acknowledgement. Unacknowledged tracked receipts are retained; consumed, stopped, invalid and uncertain work does not create a follow-up.

A completion starts one separate background-origin Run after its source succeeds. It cannot steer user work, create another completion subscription, manage Bots/groups, save skills or delegate. Current policy, target and lifecycle gates still apply to every tool. Stop and context reset persist suppression before cancelling pending delivery; replay cannot clear that tombstone. Group subscriptions reserve one of the existing twelve automatic deliveries under the original root and post, with no extra acknowledgement continuation. Limits are 64 pending subscriptions, eight per source and 4,096 retained identities. Source/continuation Runs remain pinned while needed. Bilingual inline status and explicitly labeled synthetic input use existing observation; search and previews include the assistant result, not a synthetic human request. Operational diagnostics contain IDs/state/duration, never command bodies or output. See [B15b](tasks/b15b-background-completion.md).

### 5.2 Tool Set and Dispatch

Tool Router dispatches every model-selected tool to one of two destinations. **Executor tools** cause side effects on the target and always run in the local executor. **Host tools** read or change OpenBot product state, or call configured network services with Host-held credentials, and run as `server-core` handlers. Both destinations pass the same target, policy, and scheduling checks.

| Tool | Destination | Behavior | Authorization |
| --- | --- | --- | --- |
| `local_read`, `local_list` | Executor | Read files and list directories; results end with the file's SHA-256 | Read or read-write grant for the canonical path; the shared workspace is always read-write; `local_read` may also read spilled output under `<data>/artifacts` |
| `artifact_publish` | Executor | Freeze a granted file into an immutable bounded local result; return a structured artifact receipt | Ordinary canonical read grant, target and invocation identity; no export/delete authority |
| `local_write`, `local_edit` | Executor | Create, write, or apply targeted edits; edit takes an optional `expected_sha256` and refuses when the file changed | Read-write grant |
| `local_exec` | Executor | Run a command in a working directory, stream bounded output, record exit status; a command still running after 60 seconds, or started with `background: true`, continues in the background with a `taskId` | Read-only commands inside grants are allowed by default; otherwise the command setting (ask every time by default, always allow, or never) and command rules |
| `task_output`, `task_stop` | Executor | Read new output of a background command (optionally waiting), or stop it | Allowed: the command was already authorized |
| `browser_open`, `browser_navigate`, `browser_tabs` | Executor | Open or reuse the Bot's managed-browser window and manage its tabs | Browser capability |
| `browser_snapshot`, `browser_screenshot` | Executor | Return an accessibility/DOM snapshot with element references, or a page image with frame metadata | Browser capability |
| `browser_click`, `browser_type`, `browser_key`, `browser_scroll`, `browser_select` | Executor | Apply bounded input to the Bot's window using snapshot references or frame coordinates | Browser capability and policy review |
| `browser_request_takeover` | Executor | Hand the Bot's window to the user for a login, CAPTCHA, payment, or other human-only step | Always allowed; the Run waits for the user |
| `browser_fill_secret` | Executor | Fill a field from a stored secret reference; the value never enters the transcript or model input | Secret request flow (Section 5.9) |
| `computer_screenshot` | Executor | Capture the selected display and return image metadata | Desktop capability and macOS Screen Recording permission |
| `computer_activate`, `computer_click`, `computer_type`, `computer_key`, `computer_scroll` | Executor | Activate an application or apply bounded input to the real desktop | Desktop capability, the control lease, and macOS Accessibility permission |
| `mcp__<server>__<tool>` | Executor | Call a connector tool | Connector installation plus policy rules |
| `web_search`, `web_fetch` | Host | Query the configured search provider (Tavily, key in the Keychain); fetch a public URL as Markdown (article or complete server-rendered page) or text/JSON/XML/Atom/RSS with a `retrieval_outcome` label; reject oversized bodies rather than silently dropping source context | Allowed; private and loopback addresses blocked, including after redirects |
| `memory_update` | Host | Replace or append one section of the Bot's memory (8 KB of Markdown, session document `openbot.memory` keyed by Bot) | Allowed; visible and editable in the Bot's memory panel |
| `skill_load`, `skill_save` | Host | Load a saved skill; save or revise a draft skill | Loading allowed; saving requires confirmation |
| `bot_delegate`, `bot_handoff` | Host | Delegate a subtask or transfer ownership within the accepted group task | Active assigned Run, current membership, ancestry and root budget; local receipt and public handoff |
| `routine_propose` (planned follow-up) | Host | Propose a new or changed routine for the user to confirm | Confirmation in the conversation |
| `request_user_input` | Host | Ask the user a structured question or present a form step | Always allowed; the Run waits for the user |

Tool Router validates arguments, the target, grants, policy, deadlines, and Run and control state. It persists dispatch intent before sending an invocation to the executor. Any `targetId` other than the bound local target is a hard error.

The executor independently checks the capability, `targetId`, grant version, and, for desktop input, the current control epoch before acting. It records acceptance before starting a side effect, supervises command lifetimes, drains stdout and stderr, limits output, and records exit status separately from transport status. Cancellation targets the supervised command and its process group. A closed pipe, a lost parent connection, or a killed wrapper does not establish that all descendants stopped; uncertain outcomes require reconciliation.

File grants cover canonical paths, symbolic links, and changes between validation and use. Record grants as `(targetId, capability, scope, version)`.

### 5.3 Policy, Approvals, and Auto Review

`server-core` evaluates every invocation before dispatch, in this order:

1. **Hard rules.** A non-local target, a missing OS permission, or a path outside every grant for a file tool is rejected or converted into a grant request. Model output cannot create grants.
2. **Ask first rules.** A matching rule always stops for the user.
3. **Allow automatically rules.** A matching rule proceeds unless the reviewer below escalates it.
4. **Capability defaults.** Defaults per tool family from settings, such as command execution set to ask every time.
5. **Optional model reviewer.** When Auto Review is enabled, a configured model inspects the proposed action and recent context and may escalate to ask, for example for sending, publishing, purchasing, deleting, changing permissions, or accepting terms. It can only make a decision stricter.

When rules conflict, Ask first wins. Rules match on tool, target, Bot (optional), and an argument predicate such as a working directory, command prefix, URL origin, or connector tool name. Rules are narrow by design; there is no rule that allows an entire tool family everywhere.

An approval card shows the Bot, tool, target, and exact arguments, and offers **Allow once**, **Always allow** (creates a matching Allow automatically rule after the user confirms its scope), and **Deny**. An approval binds `invocationId`, tool, target, argument digest, grant version, and validity period. Approvals in a conversation the user started wait for an answer. Approvals raised by unattended work, such as a routine or a handoff from another Bot, expire after 10 minutes; the tool then returns an `approval_expired` result and does not run.

Grant or rule revocation invalidates pending approvals and requests cancellation of affected active work. Policy is checked again immediately before dispatch. An approval controls a proposed action; it does not reverse work already completed.

B12a implements literal command/program/subcommand and canonical file/cwd subtree Ask first predicates, optionally narrowed to a Bot. Every effective policy/grant change increments one target-bound authority revision. Approval identity also binds trusted Run origin and canonical arguments; Always allow commits its resulting revision atomically. Host dispatch admission and policy changes share a short serial coordinator; running commands do not retain that lock. Restrictive changes retain a durable reconciliation intent and affected invocation metadata. The executor synchronizes revisions and acknowledges scoped termination; stale calls cannot start new effects, while exact terminal receipts remain readable. A removed folder grant conservatively affects shell work because arbitrary commands are not confined to their cwd. Unrelated proven file operations and unrelated Bot-scoped rule operations continue. Unknown termination keeps the affected authority fenced. Unattended approval deadlines survive replay and use the earlier of ten minutes or the Code Mode parent deadline. URL/connector predicates and optional model review remain separate increments.

### 5.4 Managed Browser

Browser tasks use an OpenBot-managed browser profile, separate from the user's everyday browser profile. All Bots share this profile, so signing in once makes a session available to every Bot.

- The executor launches a Chrome-family browser installed on the Mac with a dedicated `--user-data-dir` under the application data directory and `--remote-debugging-pipe`, so only the executor holds the DevTools channel; no local TCP debugging port is opened. A missing or unsupported browser is reported as a capability state.
- Each Bot owns one browser window and the tabs it opens. Browser tools address only the calling Bot's window. Windows are a coordination boundary, not a security boundary.
- Browser input goes through DevTools, not the OS input system, so Bots can work in their own windows in parallel without the desktop control lease and without Screen Recording or Accessibility permission. Background and occluded windows can be throttled by the browser; validate the launch configuration that keeps background Bots responsive.
- Every snapshot and screenshot carries `frameId`, `tabId`, page URL, viewport, and capture time. Element references and coordinates are valid only for the snapshot that produced them; navigation or takeover invalidates them.
- The Bot's conversation shows its window's latest frame and current action. The user can bring the window forward at any time to watch it.

**Takeover.** For a password, passkey, two-factor code, CAPTCHA, payment confirmation, or a site that requires a human, the Bot calls `browser_request_takeover`. The conversation shows a **Take over** card; the window comes forward; the Bot's browser tools are gated. The user completes only the blocked step and chooses **I'm done**. The Bot continues from a fresh snapshot. The Bot does not try to bypass automation checks.

Teach-a-task records DevTools navigation and input events from the Bot's window for up to ten minutes and turns them into a draft skill for review. It records no audio and excludes typed values from fields marked as passwords.

### 5.5 macOS Computer Use

Desktop tools operate the user's real interactive desktop for applications that the managed browser and connectors cannot reach. Screen Recording, Accessibility, and synthetic-input (PostEvent) permissions are separate macOS grants. Missing or revoked permission produces a visible per-grant state and an actionable error; the application cannot grant itself those permissions.

**Permission ownership.** macOS attributes a child process's privacy (TCC) access to its *responsible* process, normally the application at the top of the launch chain. Without care, every process OpenBot starts, including agent shell commands, Chromium, and MCP servers, would share any Screen Recording or Accessibility grant given to OpenBot.app. OpenBot therefore puts those grants on a dedicated helper instead:

- The helper is a separate Swift application at `OpenBot.app/Contents/Helpers/OpenBot Computer Use.app`, with its own bundle identifier, icon, usage strings, and `LSUIElement`.
- The executor launches it with responsibility disclaimed (`responsibility_spawnattrs_setdisclaim`, the mechanism behind Electron's `utilityProcess` `disclaim` option), so the helper is its own responsible process and is the only OpenBot process that holds Screen Recording, Accessibility, and PostEvent. OpenBot.app holds none of them. If disclaiming stops working, launch the helper through launchd (`SMAppService.agent`) or LaunchServices instead, which also break the chain.
- The helper talks to the executor over stdio with length-prefixed JSON frames. Screenshots are written to `0600` files in a private directory and passed by path. End of input means the parent is gone, and the helper exits.
- Grants are tied to the code signature: Developer ID signing keeps them across updates; ad-hoc signing invalidates them on every rebuild. Development builds use an Apple Development certificate and a separate `.debug` bundle identifier. Grants take effect after the helper restarts, not the whole application.

**Capture and input.** Capture uses ScreenCaptureKit (`SCScreenshotManager`); `CGWindowListCreateImage` is obsoleted in the macOS 15 SDK. Capture filters exclude OpenBot's own windows with `SCContentFilter`, because Electron's content protection no longer hides windows from ScreenCaptureKit on macOS 15 and later. macOS periodically re-confirms screen-recording access for apps that capture without the system picker; OpenBot treats that prompt as expected and pauses unattended desktop work while it is pending. Input prefers Accessibility actions (`AXPress`, setting `AXValue`) and falls back to CGEvent synthesis. Permission preflight APIs can report false negatives, so status checks confirm with a real capture.

One display is selected for control. Every capture includes `frameId`, `displayId`, `desktopEpoch`, image dimensions, capture bounds, scale, and capture time. Input coordinates are mapped from the captured image to desktop coordinates, including display origin and scaling.

Only one Bot holds the control lease at a time. Other Bots' desktop input waits at the Tool Router gate; their file, browser, and connector work continues. The lease is visible in the application and menu bar and can be paused through an action or a dedicated shortcut handled outside the executing tool.

The executor rejects input tied to an obsolete display, session, or control epoch. A lock, user-session switch, display change, pause, or handoff invalidates previous captures. Page content and application focus can change between observation and action; screenshots do not freeze the desktop. The user's physical keyboard and mouse remain usable throughout; the lease coordinates OpenBot's own actions and cannot exclude human input.

### 5.6 Connectors

Connectors are MCP servers. Installing one records its definition, required credentials, and tool namespace. The executor's connector supervisor launches stdio servers as supervised child processes and holds the client sessions for both stdio and HTTP servers.

- Connector tools are registered with Pi as deferred tools named `mcp__<server>__<tool>` and loaded through tool search, so a large connector does not fill the model's context.
- Every connector tool call passes through Tool Router and the executor like any other executor tool, with its own receipts.
- A connector's credentials come from the Keychain and are injected only into that server's process environment or request headers. No other command receives them.
- OAuth flows open in the user's default browser and return to the Host.
- Connectors are installed for all Bots. The composer's `@` menu attaches a connector to a task; policy rules can narrow which Bots may call it.

[B9a](tasks/b9a-stdio-connectors.md) implements the initial local stdio tools-only subset at MCP revision `2025-11-25`. The Host owns revisioned definitions, catalogs, mutation receipts and removal tombstones; the executor owns bounded sessions and its process journal. Pi deferred discovery is routed before loading metadata, and every connector invocation requires exact approval tied to its captured revision/schema digest. Offline registrations remain resolvable for receipt recovery but cannot dispatch fresh calls. Startup never reconnects automatically. A removal whose process or credential cleanup is unconfirmed stays visible across restart and can be retried without reviving its identity.

The initial Connect apps panel supports explicit installation, connection, inspection, credential replacement, disconnection and removal. Credentials use the reserved `connector:` namespace, are excluded from all Pi model credential methods and enter only the intended connector environment; metadata/results redact exact injected values. Stdio framing, schema/argument validation, catalog size, output, deadlines and process shutdown are bounded as specified in B9a. OAuth, composer attachment and per-connector automatic grants remain later increments. Packaged credential identity and responsibility-disclaiming launch remain native release gates.

[B9b](tasks/b9b-https-connectors.md) adds explicitly configured HTTPS endpoints with optional bearer tokens and bounded MCP Streamable HTTP JSON/SSE responses. The executor validates TLS, rejects redirects and confines tokens/session IDs to that endpoint. Ten-second handshake and sixty-second call deadlines bound network work; an additive executor cooldown table retains Retry-After across restart without sleeping or retrying a tool. Auth, expired sessions and transport failure require explicit reconnection and fresh revision/schema validation. A dispatched call without a valid result remains unknown. Local abort, best-effort cancellation and a one-second session DELETE attempt never claim to roll back remote effects. Optional idle GET streams and stream resumption remain unsupported; existing stdio definitions remain readable without rewriting them.

Prefer a connector over browser automation when one exists.

### 5.7 Bots, Memory, Group Chats, and Handoff

The accepted [D1 product design](tasks/d1-bot-product-design.md) is delivered through separate specs. [B17](tasks/b17-core-bot.md) establishes exactly one protected Core per local store, created before inference. Specialists are created only at the user's request, never seeded. Core identity is Host-owned and independent of name, Prompt and model; hide/delete/unpin are rejected before side effects. Existing Bots are preserved during migration. [B18](tasks/b18-core-management.md) adds Core-only `bot_inspect`, `bot_create`, `bot_update` and `bot_delete` Host tools. [B13a](tasks/b13a-channel-contexts.md) supplies independent channel contexts and [B13b](tasks/b13b-group-lifecycle.md) adds group lifecycle and user-directed group tasks.

Management authority comes from the persisted Core identity and its conversation, never its name or instructions. The Pi adapter memoizes the originating user Run on the invocation; the Host verifies that provenance and binds the local target. Every mutation is a durable, exact proposal requiring Allow once; command rules and folder grants cannot approve it. Specialists neither receive the extension nor pass dispatch checks. Nullable update fields mean unchanged; removing a model override requires `useDefaultModel: true`. Management tools cannot mutate the Core, memory or policy.

Bot profiles have monotonic revisions (legacy records read as revision 1). UI and management mutations share lifecycle guards and increment revisions. The desktop profile editor supplies its loaded revision and preserves drafts on conflict. Pi configured instructions include the profile revision, so persisted request sections identify the Prompt used; raw profile instructions are unchanged. A stale proposal fails before mutation; Host serialization prevents message admission or UI edits from interleaving with deletion. Deletion cancels active work and requests background-command termination before soft deletion. Pi conversation creation/configuration, profile registration/change and the successful management receipt commit together. Stable invocation identity and argument binding make replay return the committed result. Pending approval survives an unexpected Host crash; an intentional lifecycle stop withdraws its waiting action. Denied/cancelled/failed receipts remain local. Settings projects recent metadata only, excluding prompts, memory and messages. These are application authorization guarantees, not isolation from other Bots' granted shell access.

A Bot profile is an OpenBot session document containing `botId`, name, avatar, role description, instructions, model selection, enabled tool families, default working directory, and status (active, hidden, deleted). Creating a Bot creates its main Pi conversation and applies the profile through `configure()`.

**Avatar identity (D6).** Every Bot, including Core, accepts a versioned local generated recipe or an opaque image digest. Legacy profiles derive the same recipe from immutable Bot ID without changing other fields. Rename/role edits do not regenerate it. Desktop supplies the loaded profile revision; the Host validates uploaded preview bytes through a bounded executor operation and commits the image document and profile together. Image bytes live in the Host-owned `openbot.avatar` session document family, excluded from roster and model projections. Duplicate Bots share the immutable image; replacing the last retained reference clears the current image payload. Soft-deleted profiles retain their images, and SQLite backup includes them. Historical revisions and previous backups are not physically erased.

The native picker grants a one-use local source path to a private Host/executor read, not to renderer or model tools. A regular nonsymlink PNG/JPEG/WebP is bounded to 5 MiB, 4096 pixels per side and 16 million pixels before main-process decoding. Main previews a centered 256-pixel square PNG; only explicit profile Save persists it. Executor validation decodes and re-encodes the fixed-size noninterlaced PNG, strips metadata and computes SHA-256. The store allows 128 distinct retained images at 300 KiB each. Desktop retrieval is by Bot ID with generated fallback; there is no arbitrary file URL or image data in model context. These private desktop operations grant no model tool authority.

**Memory.** [B27a](tasks/b27a-memory-provenance.md) adds bounded topic notes to the existing per-Bot `openbot.memory` document without destroying legacy Markdown or B19 history. Each note keeps original and last-change provenance, an immutable topic identity and protection state; active notes project to the existing Markdown field. Local active content is limited to 8 KiB and shared active content to 4 KiB. Both retain twenty snapshots and at most 128 identities including correction/forget markers. Clear/restore are explicit owner operations, not erasure of conversation history, journals or backups.

Only a running direct user Run can create model memory writes. Host-bound Bot/conversation/Run/invocation/request references identify the learning context; they do not certify every claim. The same Pi transaction validates authority, expected revision, note protection and the invocation receipt. User corrections, forgotten topics and shared topic identities reject fresh model writes as well as stale writes; replay returns its original receipt without reapplying. Semantic aliases are not detected. Source inspection shows bounded retained Run inputs or explicitly unavailable evidence.

The owner explicitly moves notes between This Bot and Shared across Bots after reviewing the exact content and audience. Both revisions, source tombstone, destination and owner request receipt commit atomically. Shared active topics override matching local topics in direct chats and routines; forgotten shared topics suppress matching local content. Moving back to one Bot ends that suppression. Groups exclude shared content and retain existing local memory. Scope is prompt projection, not an isolation boundary on the shared Mac. Model tools cannot edit shared memory. The bilingual Memory tab provides note/source controls plus the existing Markdown/history editor. Older app writers are unsupported once structured notes are edited; backup must preserve both documents and protection metadata together.

**Parallel work.** Bots run in parallel up to the active-Run cap (Section 7.2). Each conversation has at most one active Run. Bots share files, the browser profile, and connectors; concurrent writes to the same file are serialized by the executor and checked by the edit tool's expected-content check.

B13a retains existing direct conversation IDs and stores additional channel mappings locally. Profile/model changes reach all channels, while memory remains per Bot. Core management tools are available only in its direct conversation. Submissions, reset, abort, approvals and executor receipt acknowledgement bind the actual conversation; group task traffic cannot enter the direct subscription feed.

**Group chats (B13b).** The local `openbot.groups` document stores group configuration, append-only public posts, immutable delivery inputs, management intents and replay receipts. Groups contain two to six existing Bots and a lead. IDs use the `group_` namespace and cannot alias the direct channel. The desktop user manages groups through `groups.change`; the persisted Core in its direct conversation has `group_inspect`, `group_create`, `group_update` and `group_dissolve`. Model-selected mutations require the exact Allow once approval, current revision and user-origin Run. Group contexts never receive management tools, including when their participant is Core.

A user post selects member IDs explicitly, or defaults to the persisted Core. Core is an implicit coordinator even when it is not a selected member. The lead is role metadata and does not route ordinary messages. Bot private chats retain direct routing. The Host records each recipient delivery before admitting a separate Run with request ID `delivery:<deliveryId>`. Input includes the objective and the latest twelve public posts, each capped at 2,000 characters, plus the current request. It excludes private chat history. Each Bot/group conversation shares the Bot's Prompt, model and memory. The exact Pi submission answer is published once, atomically with delivery completion, to its originating group and user post. A Bot reply does not start another Bot. Group Run identities remain durable for delivery replay; the direct-chat terminal Run retention limit does not prune them.

Removing a member invalidates its pending deliveries; dissolution invalidates all pending deliveries and keeps read-only history. Cancellation is reconciled at startup before model resumption. Existing channel observers acknowledge tool receipts with the actual conversation ID. Deleting a Bot removes it from active groups in the profile transaction, clears its lead role and pauses new routing when a group has fewer than two selected members. UI snapshots expose channel-scoped approvals and stop controls. All records remain local; inference sends the selected task context to the user's configured provider. Groups and Bots share the Mac and are not filesystem security boundaries.

**Bounded collaboration (B13c).** A dedicated channel extension exposes `bot_delegate` and `bot_handoff`; direct conversations do not receive these tools. The adapter memoizes the actual Run identity separately from management authority. Host validates the actor, channel and active Run; the store atomically validates ownership, current membership, captured roster and root limits before recording a child delivery, public handoff and fingerprinted invocation receipt. Children start only after the sender settles successfully. Delegation creates one result continuation after all children close; handoff transfers ownership without an acknowledgement wakeup. Further side effects from the transferring delivery are denied through Tool Router.

Each user group post starts a durable root. Forward depth is limited to two, and every automatic delivery, including result continuations, consumes one of twelve slots. Self/ancestor targeting and exhausted limits pause the root and invalidate pending deliveries. Normal posts never wake peers. Results stay in the group context with peer-origin Runs, never Core's management-capable direct context. `collaboration.stop` invalidates one root before cancelling its Runs. Every routed tool carries a memoized Run ID; `tasks.stop` optionally filters by that ID, so tree cancellation also stops background commands from settled Runs without touching another root in the same conversation. Executor restart retains its existing orphan-process cleanup. Dissolution also stops implicit Core group work; removal invalidates affected descendants. Stable Run request IDs and atomic answer publication reconcile restart windows without duplicating logical deliveries. Existing B13b deliveries retain their accepted recipient and input.

The desktop offers an explicit recipient picker and @ search, visible assignment/transfer/result labels, scoped approvals, root counters and bilingual pause/stop controls. An arbitrary @ string in model or user text is not a dispatch instruction unless the user selects a recipient. [B13c](tasks/b13c-collaboration.md) records the public Grok research, OpenBot-specific decisions and acceptance evidence.

**Handoff (planned).** `bot_handoff` submits a task to another Bot's conversation with the request ID `handoff:<invocationId>`, which deduplicates retransmission after a crash. Both transcripts record the handoff. Work started by a handoff is unattended for approval-expiry purposes unless the user is in that conversation.

**Role skill defaults.** [B27b](tasks/b27b-role-skills.md) adds optional `defaultSkills` references to a Bot profile. The owner previews and selects up to two exact name/revision/SHA-256 pins in Profile and saves with the existing profile revision. Missing/corrupt versions fail visibly; a new library revision never upgrades defaults automatically. Duplication preserves pins with fresh memory/history. Management tools may inspect pin metadata but cannot configure associations.

The Run scheduler composes defaults only for new direct user messages. Identical message/default references deduplicate; conflicting versions or a union above two methods fail before acceptance. The accepted Run stores explicit request references, role references and immutable procedure documents. Queueing, steering, restart, continuation and replay use those snapshots, not current profile/library state. Legacy messages retain their original replay contract. Groups, peer/background work and routines do not acquire new defaults; existing routine pins remain authoritative. Skills stay guidance under ordinary tool authorization. Older methods may remain in conversation history until a new topic starts.

**Templates (planned).** A Bot can be exported as a template containing its profile, instructions, and referenced skill names, excluding memory, conversation history, credentials, and grants. Importing a template creates a new Bot.

### 5.8 Skills and Routines

**Skills.** The skill library is shared by all Bots and stored as `skills/<name>/SKILL.md` in the application data directory, with metadata for when to use the skill, required inputs, connectors and logins, the sequence of work, validation, output, and actions that require approval. A `skills` prompt section lists names and descriptions; `skill_load` returns the content; the composer's `/` menu attaches a skill to a message. A Bot can draft a skill from a completed task with `skill_save`; the user reviews and confirms it.

**Reviewed skill contract (B10).** `server-core` validates the shared library and direct user-Run proposals; the executor owns its version database and verified `skills/<name>/SKILL.md` projection. Model loads and mutations enter Tool Router as Host tools. Every mutation requires exact approval with the current revision, then executor authority fencing; a skill never supplies a grant. Peer/group/unattended mutations are rejected. Specialists may propose procedures in private user Runs without acquiring Core management rights. The private desktop review uses the same domain service. No generic file adapter, Pi extension loader or Code Mode bridge is added.

The library admits 50 active skills, 1,024 immutable revisions, 4,096 mutation receipts and 32 KiB per canonical procedure. Quotas fail closed; editable history shows the latest 20 versions and does not evict accepted input snapshots. Intent precedes atomic projection replacement; receipt finalization reconciles only verified old/intended bytes. Changed, missing or symlinked projections are unavailable, never silently imported or overwritten. Metadata is authoritative in the executor-owned skill database, not a second Pi store. The runtime requests bounded available names/descriptions/revisions through a port for its Pi `skills` prompt section.

Direct messages may attach two exact skill references. Host resolution stores bounded content snapshots with durable Run inputs and Pi submissions; queue/restart/steering/continuation never upgrade them after library changes. Transcript chips retain names and versions, and Retry retains exact references rather than silently omitting the method. Group skill attachment is not exposed. Skill changes invalidate the existing settings observation bit; no new event stream is introduced. See [B10](tasks/b10-reviewed-skills.md) for schemas, authority and acceptance.

**Routines (B11a).** The bilingual Routines panel reviews and confirms each configuration before saving. A routine binds one Bot and local target, revisioned instructions, up to two exact skill references, a schedule and a catch-up window. Model-driven `routine_propose` is a separate follow-up.

- `server-core` schedules interval (5–10,080 minutes), daily and weekly workflows. Intervals keep a UTC anchor; calendar schedules use an IANA zone. DST gaps are skipped; folds select the first instant once. The persisted `nextAt` cursor and immutable occurrence input are committed before queue admission. Scheduled IDs are `routine:<routineId>:<scheduledAt>`; test IDs include the stable user request ID.
- A hashed channel maps atomically to one fresh ownerless Pi context per occurrence. It shares the Bot profile, memory and selected model, but excludes arbitrary private/group history, Core management, application Code Mode and collaboration extensions. Existing Run caps, lifecycle gates, current target policy and executor grants apply. Both scheduled and test Runs have unattended authority; write approvals expire after ten minutes. Routine work cannot create completion chains or save skills.
- One pending occurrence per routine; overlap is skipped. Sleep/restart admits only the latest eligible occurrence within the selected 0–72 hour catch-up window, recording skipped ranges. Zero permits only a one-minute on-time grace. Pause/edit/delete invalidates authority before cancellation. A default seven days without real desktop interaction (configurable 1–30) persistently pauses schedules until explicit resume; polling does not count as activity.
- Terminal results freeze before stable, idempotent publication of one non-model `openbot.routine-report` entry to the private chat. Reports participate in unread/search projection without inference or private steering. Actual failure/cancellation/uncertainty and confirmed artifacts remain visible. Publication-before-recording and lost-admission responses reconcile against original identities.
- **Group destinations (B11b):** optional `reportTo: { groupId, groupRevision }` is confirmed by the owner and frozen per occurrence. The group must be active and contain the owning Bot. Group edits and Bot removal invalidate affected routines and unpublished occurrences in the same transaction; routines pause until the owner edits and reconfirms their destination. Terminal group publication validates the stored occurrence, routine revision, active Bot and exact group membership, then commits one attributed `GroupPost` and its publication marker atomically. Posts include routine metadata and confirmed artifacts, participate in unread/search projection, and create no group roots, deliveries or model wakeups. Invalid destinations never redirect old reports. Group details exposes creation and existing schedules; reports link the retained occurrence. Private routines retain B11a's publication path. See [B11b](tasks/b11b-group-routine-reports.md).
- **Scheduled report composition (B11c):** optional `reportInputs` pins one to six ordinary source routine IDs/revisions in the same confirmed group, with 1–72 lookback hours and 0–60 grace minutes. The Host selects the latest matching source occurrence by original scheduled time within the summary window; production excludes test reports. Missing/pending inputs wait without Run admission until `max(scheduledAt, createdAt) + grace`. A runtime transaction freezes up to 8 KiB of published text per source plus provenance, status and truncation before admission. This explicit report projection is the only group-history input; it supplies no attachment bytes or extra authority. Terminal failures do not fall back to older successes. Source changes atomically pause dependents and revoke unpublished work; reconfirmation is required. Snapshots survive restart and source history pruning, and later arrivals never resummarize automatically. History links the captured source posts and publication includes Host-owned input coverage. Configured Specialists and the existing Core use the same generic capability; no additional coordinator Bot or peer-trigger chain is created. See [B11c](tasks/b11c-scheduled-report-summaries.md).
- Limits: 50 live routines per Bot, 500 globally, 1,024 identities including tombstones and 4,096 mutation/test receipts. Keep the latest 20 finished occurrences plus current work; prune their terminal Run projections when no longer referenced. Cursors and replay receipts survive pruning. Underlying Pi history remains local; pruning is not erasure.
- The panel exposes real-work test confirmation, selected occurrence approvals, Stop and transcript details. Scheduling runs only while OpenBot and the awake Mac are available. Event triggers, cloud scheduling and computer control are outside this increment. See [B11a](tasks/b11a-local-routines.md) for acceptance and limitations.

### 5.9 Credentials and Secrets

[B16](tasks/b16-model-sources.md) presents built-in and custom setup over one registry, with override metadata and explicit connection tests. UI authentication is API-key-only; OAuth is not implied by catalog support. Custom creation preserves JSONC and refuses existing IDs. Display endpoints expose origins only; provider test failures use safe fixed messages. Credential precedence is unchanged.

Model, search, and connector credentials are stored in the macOS Keychain by Electron main and supplied to the Host as needed over its private parent IPC channel. Renderers receive redacted settings. [B14e](tasks/b14e-main-credentials.md) defines the native binding, bounded broker and explicit legacy migration.

**Bring your own key.** The user configures endpoints in `~/.openbot/models.json` (or `$OPENBOT_HOME/models.json`), which has the shape and meaning of Pi's `models.json`, restricted to the `openai-completions`, `openai-responses`, and `anthropic-messages` APIs. Only this user-level file exists; no project or workspace file can add providers or commands. The file may use `//` comments and trailing commas; unknown properties are errors.

- An entry with a built-in provider ID overlays that provider: `baseUrl`, `headers`, `compat`, and `apiKey` apply to its models, `models` adds or replaces models, and `modelOverrides` patches individual ones, while streaming and the provider's own key sources stay. Any other ID declares a new provider; each model needs `api` and `baseUrl` at model or provider level, so one gateway can serve OpenAI- and Anthropic-protocol models together.
- A configured model whose ID is in the built-in catalog inherits its name, capabilities, limits, and cost; thinking levels and cache metadata only when the API matches. Transport `compat` is not inherited by a new provider, because a gateway relaying a model often rejects vendor-only request features; set it explicitly.
- `apiKey` and header values follow Pi's grammar: `$NAME` or `${NAME}` read the environment the Host was launched with, `!command` runs through `/bin/sh` with a 10-second timeout and a 5-minute cache of successful output, anything else is literal. Values resolve only when a request needs them; errors name the field, never the value. `authHeader: true` also sends the key as `Authorization: Bearer`.
- Key precedence, as in Pi: a key saved in Settings (Keychain), then the configured `apiKey`, then the built-in provider's own sources.
- The Host re-reads the file when settings or the model list are fetched; removing an overlay restores the built-in provider. A file that does not parse or validate contributes nothing; a single invalid provider is skipped. Problems are shown in Settings with their path in the file.

Credential handling:

- The Host implements pi-ai's `CredentialStore` over the private Desktop credential broker. Reserved search and connector namespaces are excluded from all model credential operations. pi-ai consults environment variables only when no stored credential exists, so the Host removes provider key variables such as `OPENAI_API_KEY` from its own environment at startup. A developer shell variable is therefore never used silently or inherited by child processes; only a `$NAME` reference the user wrote in `models.json` reads the launch environment.
- Electron main owns Keychain access through a fixed-path, async Node-API binding to Security.framework. Native code disables interaction, validates bounded UTF-8 input, clears temporary native secret buffers, and creates items trusting only the calling application. JavaScript strings are not claimed to be securely erased. No command-line Keychain fallback exists.
- Main stores new items under the versioned `.v2` service and owns atomic, 0600 ID indexes. Explicit migration verifies the new item and commits its index before removing legacy data; blocked ACLs and incomplete cleanup remain visible and retryable. Missing/corrupt indexes fail closed. Development/test builds require an isolated service and do not establish a supported live-credential identity. Default development launches keep their credential indexes in a separate `development-credentials/` directory; isolated test data directories own their own indexes.
- A consistent Developer ID identity across application updates remains required for release. Local ad-hoc probe evidence verifies native access denial for an ordinary Node process, but does not establish production identity continuity or notarization.
- Executor and command environments exclude credentials by default. Connector credentials are injected only into their own server.
- **Secret requests.** When a Bot needs a value it must not see, such as a password for a site field or an API key for a connector, it raises a secret request. The user enters the value in a masked field. The value is stored in the Keychain or used once, never added to the transcript, and never sent to the model. `browser_fill_secret` uses a secret reference.
- For form steps that are not secrets, `request_user_input` presents one form per step and the Bot fills the answers into the page.
- Users should not paste passwords or one-time codes into chat; the UI warns when a message looks like one.

### 5.10 Application Capabilities and Local Code Mode

[D3](tasks/d3-app-capabilities.md) specifies an authorized application capability gateway in `server-core`, pure input/output descriptors in `protocol`, and separate desktop/Pi adapters over shared domain services. [B24](tasks/b24-app-capability-api.md) implements `conversations.list/search/read`, `bots.list` and `groups.list`. Desktop search uses the same gateway services; Core reads use routed tools with structured results. The Host binds active original Run, channel, origin, root request and local target before dispatch and rechecks authority before returning. Results are limited to 32 KiB; context keeps the exact anchor and original public text, with Unicode-safe clipping. Reads do not acknowledge unread state or mutate memory. Credentials, Prompt/memory bodies, tools and reasoning are excluded from these read projections. [B25](tasks/b25-local-app-code-mode.md) composes these reads locally; [B26](tasks/b26-code-mode-management.md) adds revisioned Bot/group inspection and exact-approved management aliases for direct Core.

The Code Mode adapter uses the vendored Pi QuickJS implementation through `agent-runtime`; no remote code execution, unrestricted `env`, extra `models.*` calls or generic Host-method dispatcher is exposed. Caller identity, originating Run, scope, target and nested invocation ancestry are bound by the Host. Core direct user Runs may search retained nondeleted application history; Core group Runs are limited to that group's public content. Specialist management remains prohibited. Credentials, grants, approval decisions and Core self-modification stay outside the model surface.

The model sees `codemode` and the existing direct work/management tools. Scripts can call the five scoped application reads; direct user-origin Core scripts can also call the eight B26 management aliases. Tool Router admits the parent without holding its leaf mutex; each child re-enters the router and Host gateway with Pi task ancestry and the persisted original Run. AppExecution documents retain IDs, scope, version/catalog/source digests, absolute deadline and child statuses; Pi owns the only replay/result journal. Intermediate results stay local unless the script selects them for output. Stop invalidates the parent and pending reads; scheduler recovery remains authoritative.

QuickJS runs in a Node worker with a 64 MiB heap, at most two physical workers globally and one per conversation until actual exit. The VM bridge enforces 128 total/64 tool calls, eight outstanding calls, 32 KiB arguments/returns and 64 KiB aggregate output before crossing into the Host. Source is limited to 32 KiB. The absolute execution deadline is ten minutes for direct Core and sixty seconds for group Core, including approval waits and restart; source options may shorten it. Output defaults to 2,000 estimated tokens, at most 4,000. Pi scratch bounds remain unchanged. The worker entry, QuickJS WASM and license are staged outside app.asar beside the Host and use bundled Node. No spill environment is installed.


The parent script enters Tool Router orchestration admission without retaining a leaf sequencing lock. Every nested application call enters ordinary router validation/policy and the capability gateway, with current authorization checked again before dispatch. Typed result schemas, bounded discovery/output/worker lifetimes and stable child identities are required. Pi journals provide deterministic replay, while existing domain receipts and exact-change approvals remain authoritative for mutations. Partial script success never implies rollback. Direct Core also discovers eight management aliases; group Core discovers only the five scoped reads. Each mutation uses the existing domain proposal and exact allow-once approval. A transaction checks the original active user Run, admitted parent, deadline, nested digest and exact approval again before committing both state and receipt. The router persists a terminal management latch before releasing its leaf queue on failure, including denial; queued or caught-error retries cannot bypass it. Receipt reconciliation resolves committed effects before reporting uncertainty. Durable child activity retains object IDs and revisions, and nested approvals remain visible before the first child completes and after restart. Direct Core parents allow ten minutes including approvals/restart; group parents retain sixty seconds. Both may be shortened by source options. D3 specifies the remaining resource, privacy and presentation contracts; the B25/B26 specs record verification evidence.

## 6. Local Interfaces

### 6.1 Desktop Application Protocol

The transport is private IPC with versioned request, response, and event envelopes. Electron main validates renderer calls and forwards allowlisted methods to the Host. A native file selection supplies a scoped selection reference; a renderer-supplied arbitrary path is not evidence of a user grant.

| Method | Semantics |
| --- | --- |
| `bots.create`, `bots.update`, `bots.list`, `bots.duplicate`, `bots.delete`, `bots.export`, `bots.import` | Manage Bot profiles and templates; Duplicate copies profile and Prompt with empty memory and history; Delete cancels the Bot's Run and keeps its conversation on disk |
| `bots.memory.get/update/restore`, `memory.shared.get/update/restore`, `bots.memory.note/source` | Inspect local/shared notes and history, owner-only scope moves, bounded source evidence; revision and request identity checks |
| `conversations.list`, `conversations.markRead` | Bounded local Bot/group latest-message summaries and durable read cursors; acknowledge a rendered snapshot through its incoming-message ordinal |
| `observation.wait` | Bounded topic invalidation with a Host stream ID and revision; one pending request per production consumer and four per Host |
| `conversations.snapshot`, `conversations.subscribe`, `conversations.reset` | Deliver the current direct-chat view and subscribed updates; start a new topic |
| `groups.create`, `groups.update`, `groups.delete` | Manage group chats and membership |
| `messages.submit` | Accept `requestId`, conversation, content, mentions, skill and connector attachments, and artifact references; return `runId`, state, and whether the message steered an active Run, after durable receipt |
| `runs.cancel`, `runs.pause`, `runs.resume` | Persist an idempotent cancellation or pause request and report its outcome separately |
| `approvals.decide` | `allow_once`, `always_allow` with a confirmed rule scope, or `deny` for the exact pending invocation |
| `policy.get`, `policy.update`, `policy.rules.delete`, `policy.ask.create`, `policy.ask.delete`, `policy.reconcile` | Target-bound policy revisions, command defaults/allow rules, bounded Ask first predicates and durable scoped-revocation reconciliation; user-only methods |
| `grants.list`, `grants.add`, `grants.revoke` | List, add (folder picked in a native dialog by main), or revoke folder grants for a `targetId` |
| `models.list`, `models.addProvider`, `models.test` | List models, declare an OpenAI- or Anthropic-compatible endpoint in the model configuration file (never its key), and send one small test request |
| `skills.list`, `skills.get`, `skills.save`, `skills.delete` | Manage the skill library |
| `routines.list`, `routines.confirm`, `routines.update`, `routines.setEnabled`, `routines.testRun`, `routines.delete`, `routines.runs` | Manage routines and inspect their run history |
| `connectors.list`, `connectors.install`, `connectors.connect`, `connectors.disconnect`, `connectors.remove`, `connectors.credential.set/delete` | Explicit local stdio and HTTPS configuration and credential lifecycle (B9a/b); OAuth authorization remains planned |
| `browser.status`, `browser.takeover`, `browser.release` | Report managed-browser state; take over or release a Bot's window |
| `computer.status`, `computer.control` | Report OS permission, session, and lease state; pause or hand back control |
| `secrets.provide`, `secrets.cancel` | Answer a secret request; the value travels only from main to Host |
| `inputs.provide` | Answer a structured question or form step |
| `artifacts.import`, `artifacts.export` | Main-only selected-path copy operations; named preload pickers never accept renderer paths |
| `artifacts.get`, `artifacts.preview`, `artifacts.remove` | Bounded immutable metadata/content and explicit local-copy removal; removal retains a tombstone |
| `credentials.status`, `credentials.migrate` | User-only redacted storage state and explicit bounded migration; no public credential read method |
| `settings.get`, `settings.update`, `usage.get` | Read redacted settings, update configuration (including local `language: en \| zh-CN`, default English), and read per-Bot usage |

Private `credential.request` / `credential.response` messages are separate from Host methods. Only the currently supervised Host child can request list/status/get/set/delete/migrate; no request selects a service or path. Both endpoints validate exact bounded shapes. Main serializes up to eight operations; Host caps eight pending requests with a ten-second deadline. Disconnects and write timeouts return unconfirmed outcomes; late replies cannot reach a replacement Host. Renderers, model tools and the executor have no broker channel.

A request carries `protocolVersion`, `messageId`, `method`, and `params`. Electron main and the Host both validate `params` against the method's TypeBox schema (`@openbot/protocol/schemas`) and answer `invalid_request` otherwise. Mutating operations include a stable application request identity where retries could otherwise create duplicate work. `messages.submit` returns the same Run for the same request ID and content; different content under that ID is a conflict. Durable receipt does not mean model generation has started. A Bot's queued Run collects messages sent while it waits. Text-only messages combine into one input; when attachments are present, original messages remain separate bounded inputs with immutable ordered refs. Pi admission replays its stable request ID before hydrating files.

B15a private-chat file input supports bounded UTF-8 text and PNG/JPEG. The executor copies selected files into `attachments/`, validates size/signature/dimensions and hashes, and owns metadata and operation receipts in `attachments/metadata.sqlite`. The Host uses a target-bound private `artifact.request` / `artifact.response` port (four outstanding requests, ten-second timeout). Pi gets content parts through `agent-runtime`; Desktop/search project original user text and filenames, never injected bodies or base64. D9 opens result filenames in a non-modal, tabbed right-hand reader beside the conversation. Up to twelve tabs retain independent reading state during switching; stable file identities and canonical web URLs deduplicate reopens. react-resizable-panels supplies the three-column layout, keyboard/pointer resizing and local width persistence. Document rendering uses react-markdown and unified plugins for Markdown, React-PDF/PDF.js for PDF, Papa Parse for CSV and native image rendering. PDF is an additional published result format; model input formats stay unchanged. Group posts may show artifacts published by that exact delivery; group file inputs remain deferred. See [B15a](tasks/b15a-bounded-artifacts.md) for quotas, recovery and removal semantics.

[D9](tasks/d9-file-reading.md) adds read-only workspace listing/reading and native file selection through the same private target-bound executor transport. Native selection never imports content into a chat or grants a model access. Workspace paths reject traversal and symlinks; listing caps at 500 entries, text at 2 MiB, binary previews at 8 MiB. Shared artifact listing is metadata-only and full reads validate immutable copies. HTML uses a sandboxed Electron WebContentsView owned by the application window, with no Node or preload and a separate in-memory browser session. Its ephemeral preview protocol serves only that window’s selected HTML. HTTP(S) resources and linked pages work normally; requests/navigation reject file/app/custom protocols, device permissions and downloads. Main IPC rejects every guest frame. Each tab owns an opaque browser ID; main validates both ID and window ownership. Only the active native view is visible; inactive views remain alive with background throttling. Native views follow panel bounds and hide during divider dragging or application modals. Closing a tab releases its view and preview URL; closing the panel or navigating the owner destroys all its native views. Preview capacity rejects overflow without evicting another tab. HTTP(S) addresses and chat/document links can open page tabs. This is user-operated document reading, not the Phase 3 model-controlled browser capability.

Desktop observation uses `observation.wait({cursor?: {streamId, seq}, waitMs?})`. A response carries only the current stream identity, revision and a topic bitmask: roster/summaries (1), groups/summaries (2), selected direct conversation (4), settings/models/lifecycle (8). The Host retains four last-change revisions; no event payload queue crosses IPC. Each consumer refreshes affected snapshots before requesting the next observation, at a minimum 100 ms cadence. Missing, changed-stream or ahead cursors request every snapshot; equal cursors wait at most five seconds. Sequence gaps represent coalesced current state, not lost durable records. Four pending waits bound abandoned renderer requests; excess requests are rejected. Main has its own observer and coalesced roster reads for native attention when the window is closed.

Snapshot reads are single-flight per resource. New refreshes invalidate older reads; Host and selection changes reject stale results. Observation does not move read cursors, clear drafts or reset an active search target. Domain stores remain authoritative for approvals, Runs, messages and receipts; cross-document snapshots are not transactional. B14c separates live snapshots from bounded history windows; production observers and control reads omit committed transcript bodies. See [B14a](tasks/b14a-reliable-observation.md) for limits and recovery acceptance.

Electron main raises macOS notifications for approvals, takeover and secret requests, completed or failed Runs, and routine reports. Dictation in the composer uses macOS on-device speech recognition or a configured transcription endpoint.

### 6.2 Executor Protocol

The Host and the executor exchange a startup handshake containing protocol version, process-instance identity, supported capabilities (files, commands, browser, desktop, connectors), and the executor's bound `targetId`. The connection is owned by the Host and accepts requests only from its parent.

| Message | Contract |
| --- | --- |
| `tool.invoke` | Invocation ID, Bot, Run, and conversation IDs, tool name, arguments and digest, target, deadline, and authorization (read-write and read-only grant lists). A repeated invocation is answered with its recorded state instead of a separate acknowledgment |
| `tool.progress` | Sequenced, bounded output or progress; never a substitute for terminal status |
| `tool.result` | Terminal status, result content or references, exit details, and structured errors |
| `tool.status` | Reconcile a previously accepted invocation after interruption |
| `tool.cancel` | Request termination; report confirmed termination or an uncertain outcome |
| `result.ack` | Confirm that the Host persisted the terminal receipt |
| `tasks.inspect` / `tasks.inspected` | Private target-bound inspection/acknowledgement of up to 16 known background task and invocation identities; ten-second timeout; no model access |
| `tasks.stop` | Stop every background command a conversation started, when the user stops its Run |
| `control.revoke` | Invalidate the current desktop control epoch and block subsequent desktop input |
| `browser.gate` | Gate or release one Bot's browser window for takeover, pause, or cancellation |
| `connector.ensure`, `connector.stop` | Start, verify, or stop a connector server with its injected credentials |

Desktop actions additionally carry the current desktop and control epochs; browser actions carry the snapshot's `frameId`. Model output cannot choose another target or forge a grant.

The executor retains terminal receipts until the Host acknowledges persistence. Repeated invocations return existing state; a repeated ID with different arguments is rejected. After receipt compaction, retained completion identities or a retired executor epoch must still prevent an old invocation from executing again. An execution whose side effect may have happened but whose result is missing becomes `unknown`.

### 6.3 Later Multi-Target Seam

When another target is added, it receives its own `targetId`, capability advertisement, and Host-owned connection; the same `tool.invoke` envelope applies over a different transport; approvals and control UI show which target is affected; and failure domains stay per executor. This section is a seam only.

### 6.4 Desktop Application

[B14c](tasks/b14c-history-scaling.md) implements bounded history windows, persistent derived search and virtualized reading. The agent-runtime adapter subscribes to Pi commits, coalesces source identities and scans public entries in batches of at most 256. Its worker exclusively owns `<data>/cache/history-v1.sqlite`; the worker never opens Pi storage. Rows, tool-result links and source checkpoints commit atomically. Reopen validates source identity and checkpoints; restore and rollback discard the cache. Worker failure permits one automatic rebuild, then explicit Retry, without gating execution or approval settlement.

Desktop reads live control state with `history: "omit"`, then `conversations.window` (latest, around a stable row ID, or cursor; at most 100 rows and 512 KiB). Group `deliveryId` and Bot `occurrenceId` selectors resolve private execution channels in the Host, bind every cursor/detail reference, exclude public search and never acknowledge reading. Oversized rows use an 8 KiB preview and 32 KiB UTF-8 display-text parts. TanStack React Virtual 3.14.23 measures visible rows; the renderer retains at most three 100-row windows for each of three conversations, 8 MiB total, 100 lightweight anchors and three detail parts. Legacy full snapshots remain diagnostic/test compatibility helpers only. Canonical group documents and Pi active context remain separate sources of memory growth.

`apps/desktop` is an Electron application built with electron-vite and packaged with electron-builder. Its interaction model follows Grok Bot's desktop app (Section 6.5).

```text
apps/desktop/
  electron.vite.config.ts
  src/
    main/
      index.ts            # Lifecycle: single-instance lock, window, tray, login item, power events
      host.ts             # Spawn and supervise the Host Runtime; request/response and event routing
      ipc.ts              # Allowlisted renderer methods: sender check, argument validation, forwarding
    preload/
      index.ts            # contextBridge: one named function per allowed method; no generic invoke
    shared/
      api.ts              # The renderer-facing method map, typed from @openbot/protocol
    renderer/
      index.html
      src/                # React: sidebar roster, conversation, composer, work panel, settings
```

Rules:

- **Main owns processes; the renderer owns nothing privileged.** Main starts the Host, holds the only Host connection, and is the only code that shows native dialogs, notifications, tray menus, and global shortcuts.
- **Named methods only.** The preload exposes one function per Section 6.1 method. A generic `invoke(channel, args)` is not allowed. Main checks that every call comes from the application's own frame and validates arguments before forwarding.
- **Typed end to end.** `shared/api.ts` is derived from `@openbot/protocol`, so a renamed or removed method fails type checking in main, preload, and renderer. Runtime validation uses one TypeBox schema per method from `@openbot/protocol/schemas` (TypeBox is the version Pi already uses); a method without a schema fails type checking.
- **Snapshots with observation credit.** One `observation.wait` response invalidates affected snapshots. The renderer completes coalesced reads before granting more credit; Host changes invalidate old reads and refresh current state. No transcript event payloads are pushed into a suspended renderer.
- **Secrets never reach the renderer.** A secret request renders a masked field, but the value goes renderer → preload → main → Host in one call and is never kept in renderer state. Settings arrive redacted.
- **Closing the window is not quitting.** The tray menu, the dock, and the global shortcut reopen the window. Quit runs the Section 8.1 shutdown sequence before the process exits. Main relays `powerMonitor` suspend, resume, lock, and unlock events to the Host, and holds `powerSaveBlocker` only while Runs are active.

Security baseline:

| Area | Setting |
| --- | --- |
| Fuses | `RunAsNode`, `EnableNodeOptionsEnvironmentVariable`, and `EnableNodeCliInspectArguments` off; `EnableEmbeddedAsarIntegrityValidation`, `OnlyLoadAppFromAsar`, and `EnableCookieEncryption` on; `GrantFileProtocolExtraPrivileges` off |
| Windows | `contextIsolation`, `sandbox`, and `webSecurity` on; `nodeIntegration` off |
| Loading | Packaged builds serve the renderer from a custom `app://` protocol with a strict Content Security Policy; never `file://` |
| Navigation | `will-navigate` is blocked; `setWindowOpenHandler` denies new windows and sends allowlisted `https:` links to `shell.openExternal` |
| Permissions | Session permission request and check handlers deny by default |
| Child processes | User commands and MCP servers start with responsibility disclaimed so they do not inherit any OpenBot grant |

Toolchain and libraries, as of 2026-10-15:

| Concern | Choice | Notes |
| --- | --- | --- |
| Shell | Electron 44 | Bundles Chromium 152 and Node 24.18; requires macOS 13 or later. Tauri, Electrobun, and a native Swift shell were rejected: each leaves Node supervision, login items, or power assertions to the application, and WebKit rendering differs from the Chromium that the executor drives |
| Build | electron-vite 5 | 6.0.0 was released on 2026-10-15; adopt it after it settles. Electron Forge 8 is the first-party alternative |
| Package, sign, update | electron-builder 26 with electron-updater 6 | Built-in fuses, universal builds, nested-binary signing, and update manifests with staged rollouts |
| Renderer | React 19, Zustand for conversation stores, TanStack Query for settings and rosters | |
| Transcript | TanStack Virtual (`anchorTo: "end"`), Streamdown for streaming Markdown, AI Elements components adapted as source | All MIT or Apache-2.0. The Virtuoso message list is commercial; assistant-ui is pre-1.0 and has cloud dependencies |

References: [goose `ui/desktop`](https://github.com/aaif-goose/goose/tree/main/ui/desktop) (Apache-2.0) for backend supervision, tray, and approval components; [UI-TARS-desktop](https://github.com/bytedance/UI-TARS-desktop/tree/main/apps/ui-tars) (Apache-2.0) for the typed router shape and macOS permission flow; [Eigent](https://github.com/eigent-ai/eigent) and [AionUi](https://github.com/iOfficeAI/AionUi) (Apache-2.0) for process health checks and multi-agent UI. Cherry Studio (AGPL-3.0), Chatbox (GPL-3.0), and LobeHub (custom license) are for reading only. Copying Apache-2.0 code requires keeping its license header and adding a NOTICE entry.

### 6.5 Interface Model

The desktop interface follows Grok Bot's layout and vocabulary so that users and contributors can rely on a known product.

B21 implements a shared private/group conversation shell, name/role filtering, unified New, responsive contextual details, structured group mentions and scroll anchoring. Private chats remain direct; ordinary group messages go to Core. The renderer stores versioned drafts and immutable send attempts locally, persists before dispatch and retries uncertain delivery only on explicit request using the same Host request ID. Newer edits survive late acknowledgements. Drafts are not model context and are not synchronized. The broader target interface below includes future surfaces tracked by separate task specs.

[B22](tasks/b22-conversation-list.md) stores a bounded latest-message preview and monotonic incoming/read ordinals per private or group conversation in the Host-owned `openbot.conversation-index` session document. It is local presentation metadata, excluded from model context and diagnostics. Group publication updates the index atomically; direct projections catch up from retained history before publishing snapshots. Missing legacy records seed existing history as read. `conversations.list` reads this index without loading transcripts; `conversations.markRead` validates `{ conversationKey, through }` against the current incoming count. Snapshots supply the rendered read cursor, so a delayed acknowledgement cannot clear newer replies. Auto-read requires native-window and document focus/visibility, an unobstructed timeline and 400 ms at the bottom; explicit Mark as read uses the same snapshot cursor. Activity and drafts preserve independent unread counts. Core-first and pinned ordering stay protected while other rows follow latest committed message time within the single Chats list.

[B23](tasks/b23-conversation-search.md) adds `conversations.search` with a literal query, unread/hidden filters and a bounded continuation cursor. `agent-runtime` projects committed user/assistant and public group text into the B14c worker sidecar, reconstructed from Host-owned durable history before search readiness. The Host resolves current Bot/group and unread eligibility. Searches do not load histories, mutate read state, invoke models, or emit search content to diagnostics. Results contain at most 30 stable message references and 180-code-point snippets. Renderer queries and targets are transient; exact-message navigation suppresses automatic read acknowledgement until ordinary navigation or Jump to latest. B14c stores that public corpus in the disposable worker sidecar. Searches preserve JavaScript Unicode literal matching, normalized snippets, stable order and a first-page insertion boundary. They scan bounded batches with cancellation, four admitted search/context jobs and a five-second deadline. Context reads fetch only the anchor and up to ten neighbors on each side. Worst-case search CPU remains linear; retained public text is no longer duplicated in an in-memory search map.

[D6](tasks/d6-desktop-design.md) uses a plum navigation frame and lilac conversation surface with unboxed assistant replies, pale user bubbles and shared author avatars. Core uses the same row geometry as Specialists with a static accessible identity star; editable names never determine authority. Direct conversation details open a focused modal profile/memory editor with avatar candidates/upload, name, role, Prompt and expandable model/role-skill controls. Group details retain the responsive contextual panel. Existing drafts, search, read state, approval actions and lifecycle controls remain intact.

[D8](tasks/d8-chat-experience.md) combines private and group conversations into one Core/pinned/recency list, uses member-avatar clusters for groups, and exposes search/New plus a bottom-left Settings icon. Normal global pause lives in General Settings; blocked chat surfaces retain contextual resume. Shared activity feedback covers submission, queues, generation, tools, approval/user waits and retry. Private and group partial replies use sanitized Marked blocks with stable completed-block DOM and existing scroll anchoring; scheduled reports remain atomic publications. B14c adds bounded virtualized history around that streaming path.

| Area | Content |
| --- | --- |
| Sidebar | Search (`Cmd+K`) and **New** (`Cmd+N`), one Chats list combining Bots and groups, ordered Core first then pinned/recency; expandable **Hidden Bots**; one bottom-left Settings icon (`Cmd+,`). Search reveals unread filters. Routines, Skills and Connect apps live inside Settings. Bot rows retain attention, working and unread states. |
| Conversation | Header with the Bot's name, label, and menu (Edit profile, Pin, Hide, Duplicate, Delete). The transcript shows messages, grouped tool activity with status, computer and browser steps with thumbnails, created files, questions, forms, approval cards, takeover cards, secret requests, and drafts. A Normal or Verbose toggle controls tool detail |
| Composer | Attachments, `/` for skills, `@` for Bots, groups, routines, and connectors, dictation (`Cmd+D`), Send (`Enter`), new line (`Shift+Enter`), and Stop while a Run is active. Sending while a Bot works redirects the current Run |
| Work panel | Opens beside the conversation (`Cmd+Shift+I`): Browser (live screencast of the Bot's window, Take over), Screen (desktop control state and lease), Files, and Activity |
| Approval card | The Bot, the action, target and values, and where the Run came from; **Allow once**, **Always allow** (previews the rule it saves), **Deny** (Esc). Cards from unattended work show **Expired** after 10 minutes |
| Takeover card | **Take over** brings the managed browser window forward and gates the Bot; **I'm done** releases it and the Bot continues from a fresh snapshot |
| Group chat | Two to six Bots; `@mention`, `@everyone`, and reply-to-Bot; handoffs are visible. Approvals, secret requests, and drafts appear only in the owning Bot's conversation, with a link from the group |
| Menu bar | Running Bots, pending approvals count, **Pause all**, Open OpenBot, Quit |
| Desktop control | While a Bot holds the control lease, the computer-use helper draws a screen border and a small HUD with the Bot, its action, and Pause or Stop. Esc during control and a global pause shortcut stop input. Physical keyboard or mouse input pauses the Run |

## 7. Durable State and Scheduling

### 7.1 State Ownership

| State | Owner |
| --- | --- |
| Conversations, model context, generation tasks, tool tasks, and compaction | Pi Durable in the Host |
| Bots, memory, groups, message queues, Runs, policy rules, grants, approvals, invocation records, routines, connector definitions, and settings | Versioned OpenBot documents in the Pi store, accessed through the runtime adapter |
| Command lifetimes, invocation acceptance, final execution receipts, and retransmission | The executor's separate persistent ledger |
| Unsent drafts and immutable send attempts | Versioned local storage in the desktop renderer partition; Host receipts remain authoritative for accepted messages |
| Skill library | Files in the application data directory |
| Durable artifact contents | Executor-owned `attachments/` blobs and SQLite operation/metadata ledger; immutable refs in Run/Pi/group documents; 256 MiB / 4096 records, explicit removal |
| Disposable command output | `artifacts/`, 10 MiB/file, 64 MiB total, 4096 files, seven-day startup expiry; bounded head/tail and honest loss markers |
| Managed-browser profile, cookies, and logins | The browser's user-data directory owned by OpenBot |
| User files | The shared workspace and user-selected directories |
| Credentials and stored secrets | The macOS Keychain, owned by Electron main; transient private IPC use by the Host; main-owned ID indexes |
| Capture and input readiness | Live macOS observations and an expiring control epoch |

### 7.2 Scheduling

OpenBot keeps a durable Run queue. A Run starts when its conversation is idle and the number of active Runs is below the configurable cap (default 3); queued Runs are admitted oldest first across Bots. Routine occurrences wait for a slot like user work but run in their own conversations. One Run may execute per Bot. Direct queued work has priority; non-direct work aged 30 seconds joins the oldest-first tier. A user message to a Bot with an active Run in the same channel steers that Run (`whenBusy: "steer"`) instead of starting a new one; a message to a Bot whose Run is still queued joins that queued Run. Pi's submission ID is associated with the OpenBot Run; the stable request ID reconciles a crash between Pi admission and recording that association.

Within a Run, tools are sequential. Across Runs, the executor accepts concurrent invocations; it serializes writes to the same file, and desktop input waits for the single control lease.

Run states are `queued`, `running`, `waiting_approval`, `waiting_user`, `paused`, `cancelling`, `needs_attention`, `completed`, `failed`, and `cancelled`. `waiting_user` covers takeover, secret requests, and structured questions. Closing an observation stream changes connection state only. Cancelling one Run leaves queued messages and other Bots' work intact.

Product-state transactions persist approvals, policy decisions, and dispatch intent before external execution. Execution receipts and Pi results are correlated because database transactions cannot include filesystem, command, browser, or desktop side effects.

### 7.3 End-to-End Message Flow

Consider: "Read my project notes, research the topic on the web, and save a report in the project."

```mermaid
sequenceDiagram
    participant UI as Desktop
    participant H as Host Server Core
    participant P as Pi Runtime
    participant M as Model Endpoint
    participant T as Tool Router
    participant E as Local Executor
    participant OS as Files and Managed Browser
    UI->>H: messages.submit with requestId
    H->>H: Persist receipt and queue Run for the Bot
    H-->>UI: Accepted with runId
    H->>P: Submit when the conversation is idle and a slot is free
    P->>M: Context and tool definitions
    M-->>P: local_read invocation
    P->>T: ToolInvoker with stable invocationId
    T->>H: Policy and grant check, persist dispatch intent
    T->>E: tool.invoke on the local target
    E->>E: Validate and record acceptance
    E->>OS: Read authorized file
    OS-->>E: Content
    E->>E: Persist execution receipt
    E-->>T: tool.result
    T->>H: Persist receipt and acknowledge executor
    T-->>P: Tool result
    P->>M: Continue with result
    M-->>P: browser_navigate and browser_snapshot
    P->>T: Execute
    T->>E: Browser invocation in the Bot's window
    E->>OS: Drive the managed browser
    OS-->>E: Snapshot
    E-->>T: Recorded result
    T-->>P: Tool result after receipt persistence
    P->>M: Continue
    M-->>P: local_write report
    P->>T: Execute after policy check
    M-->>P: Final answer
    P-->>H: Committed conversation state
    H-->>UI: State updates, report reference, notification
```

Policy can stop dispatch for approval before any file, command, browser, desktop, or connector action. Tool results, including durable references to snapshots and screenshots, are committed before later model steps use them.

## 8. Lifecycle, Recovery, and Storage

### 8.1 Human Control and Application Lifecycle

Closing the conversation window leaves the menu-bar application, Host Runtime, and admitted work running. OpenBot can register as a login item so routines run after login. While Runs are active or a routine is due soon, the Host holds a macOS power assertion that prevents idle sleep; it cannot prevent sleep when the lid closes or the user chooses Sleep.

| Event | First-release behavior |
| --- | --- |
| Conversation window closes | The application, Host, admitted Runs, and routines continue while the Mac is awake and required permissions remain available |
| User pauses a Bot or takes control | Block new tools for that Run, gate its browser window or revoke the desktop lease, and reconcile the active invocation before continuation |
| User quits the application | Stop admission, preserve queued messages, cancel supervised active work, flush state, stop the browser and helpers; unresolved effects remain visible on next launch |
| Session locks | Keep authorized non-interactive background work available; future desktop/browser input must independently gate on lock state |
| Mac sleeps | Gate execution and reconcile supervised actions; uncertain effects remain interrupted |
| Mac wakes | After confirmed suspend reconciliation, automatically admit eligible new work and coalesced routine occurrences; never replay interrupted actions |
| Session unlocks | Update native state without pausing or restarting background work |
| Display, focus, or session changes | Revalidate the target and capture a fresh frame before dependent desktop input; observed unsafe changes pause control |
| Browser exits or crashes | Gate browser tools, reconcile in-flight browser invocations as `unknown` when their effect is uncertain, and relaunch with the same profile |
| Executor, native helper, or connector exits | Block dependent tools, reconcile receipts and command state, then restart the process if appropriate |
| Host Runtime exits | The executor loses its parent lease, stops accepting work, revokes input, and attempts to terminate supervised commands and connector servers |

[B14b](tasks/b14b-lifecycle-gates.md) supplies the Host execution gate; [B11d](tasks/b11d-unattended-reliability.md) separates native lock state from non-interactive work admission. Desktop-launched Hosts wait for an ordered native snapshot. Lock alone does not cancel model, file, command, network or connector work. Commands still run as the user; lock is not an OS sandbox. No model-driven interactive browser/desktop control is implemented here.

Suspend gates execution synchronously, interrupts active Runs and quiesces the Executor. Optional `LifecycleRecord.autoResume` is persisted only after confirmed quiescence, allowing new queued/scheduled work on wake. User pause, unsuccessful reconciliation, legacy recovery and quit recovery remain explicit. Interrupted private tasks require Continue; interrupted group chains require a new request. An idle quit adds no recovery prompt. Native source, sequence and epoch checks prevent a racing pause from being cleared by wake.

The gate is checked before policy, after asynchronous authority checks, after approval, and at executor transport admission. `execution.quiesce` is a private target-bound exchange; a missing or uncertain acknowledgement keeps work blocked. Interrupted Runs retain intent and become terminal `needs_attention` only with an honest settlement record. A committed answer remains completed. Lifecycle events and receipts contain metadata rather than prompts or command output. The first increment has sidebar controls; menu-bar Pause all, per-Bot pause, native control leases, login items and routines retain their separate delivery scope.

Pausing gates tool dispatch; it does not assume Pi can serialize an in-memory waiting function. If cancellation or interruption terminates a Pi submission, continuation uses committed history and an explicit follow-up rather than reviving the old command. I1 preserves original immutable per-message attachment references in a separate continuation Run, including inputs interrupted before Pi admission. Missing copies fail visibly; a repeated continuation request reuses the accepted Run and cannot steer unrelated work.

### 8.2 Recovery and Cancellation

On launch, the Host acquires exclusive ownership, opens storage, validates the executor handshake for the local target, reconciles unfinished invocations, and checks the desktop and browser state before enabling scheduling. Gate every Pi scheduling entry point, including `resume`, `submit`, and `wait`, until that check completes. The routine scheduler starts only after recovery.

A known terminal execution receipt is reconciled without executing again. Routed tools resume under the replay rules in Section 5.1. If an executor may have performed a side effect before losing its result, mark the invocation `unknown` and the Run `needs_attention`. Do not infer completion or safe retry from a missing process ID, transport disconnection, or an empty result.

Cancellation is a persisted request followed by an observed outcome. Enter `cancelled` only when active tool termination is confirmed or no tool was dispatched; an uncertain termination enters `needs_attention`. PID reuse, detached descendants, and external effects mean killing the command wrapper alone is insufficient evidence.

### 8.3 Data and Backups

The application data directory, normally `~/Library/Application Support/OpenBot/`, holds the conversation database (`openbot.sqlite`), spilled tool output (`artifacts/`, kept 7 days), immutable selected/published files (`attachments/`, explicitly removed), executor receipts (`executor/receipts.sqlite`), the skill library, the managed-browser profile, and bounded operational logs (`logs/host.log`, rotated at 5 MB). The shared workspace defaults to `~/OpenBot` so the user can see and edit Bot files. Other user files stay in explicitly selected directories.

The Pi SQLite adapter uses WAL with `synchronous = NORMAL` at the reviewed baseline. Commits survive process crashes; the newest commits may be lost on power or host failure. Validate the storage behavior before making stronger durability guarantees.

Clearing current memory is not data erasure. Retained memory versions, Pi journal entries, conversation context, backups and prior provider requests may still contain old facts. New topic excludes earlier conversation context from subsequent requests while retaining the current memory document.

[B14d](tasks/b14d-backup-restore.md) implements same-Mac/account local directory snapshots. Desktop main owns folder selection and interruption/replacement confirmation, persists user pause, and requires confirmed Host/executor shutdown. The offline Host maintenance entry holds the same exclusive Host lock, composes the server-core snapshot service and uses agent-runtime to force a paused restored lifecycle. An offline executor helper validates its own process/file-mutation records without starting adapters. Desktop continues to depend only on protocol.

Version-1 snapshots contain the Host SQLite database, executor ledgers, saved attachment bytes/metadata and reviewed skill library. SQLite is checkpointed and copied databases use DELETE journal mode so read-only verification cannot create WAL sidecars in the archive. The manifest records application, protocol, runtime/Pi compatibility provenance, Mac/account binding, exact scope and per-file lengths/SHA-256. Bounded validation rejects unsupported versions, unsafe paths, symbolic links, changed/missing/extra files, invalid databases and unfinished executor process/file records. Credentials, model configuration, browser profiles, logs, temporary output spills and original workspace files are excluded.

Restore validates and stages content, verifies a Core profile and writes the pause gate without resuming Pi. It saves a pre-restore snapshot, journals allowlisted root replacements and keeps rollback copies. Startup rolls back an uncommitted transaction before starting the Host; committed transactions finish cleanup. UI reload occurs through main after the replacement Host is ready. Export and restore leave work paused for deliberate continuation. Cross-machine migration, encryption, scheduled/cloud backup and workspace backups require separate scope.

Record application, Pi, protocol, and data-format versions for diagnosis and upgrades. Use `botId`, `runId`, and `invocationId` to correlate logs. Operational logs exclude credentials and secret values and avoid collecting full file content, page content, or screenshots by default. Verify migrations against a backup before advancing the data format.

Removing access follows the same steps as in a hosted product: pause or delete routines, sign out of sites in the managed browser, remove connectors and revoke their authorization at the service, delete sensitive workspace files, and hide or delete Bots. Deleting a Bot cancels its Run, hides it everywhere, and refuses further messages; its profile, conversation, and memory stay in the database until a later purge removes them. Shared files, browser sessions, and connectors remain.

## 9. First-Release Scope

| Area | First release |
| --- | --- |
| Product | One macOS desktop application; Host, executor, and managed browser on the user's Mac |
| Targets | The local target only; the protocol carries `targetId`; other targets are rejected |
| Bots | Named Bots with profiles, memory, parallel Runs up to a cap, group chats, handoff, and templates |
| Agent | Configurable model per Bot, streaming conversations, history, compaction, queueing, steering, and cancellation |
| Files and commands | Shared workspace, selected directory grants, read/list/write/edit, and policy-controlled commands |
| Browser | Managed shared profile, one window per Bot, snapshots, input, takeover, secret filling, and teach-a-task |
| Web | Configurable web search and public-page fetch |
| Desktop control | Selected-display screenshots, application activation, keyboard and mouse input, permission status, visible lease, pause, and handback |
| Connectors | MCP servers supervised by the executor, Keychain credentials, deferred tool loading |
| Skills and routines | Shared skill library, time-based routines with test runs, history, coalesced catch-up, and pause after long absence |
| Policy | Grants, Ask first and Allow automatically rules, optional model reviewer, approval expiry for unattended work |
| Notifications and voice | macOS notifications and composer dictation |
| Persistence | Local conversation state, execution receipts, artifact references, and explicit interrupted-work recovery |
| Packaging | Bundled runtime and helpers, stable macOS application identity, startup diagnostics, and backup guidance |

Not in the first release: cloud computer, mobile clients, multi-device sync, live voice conversation, inbound event webhooks, additional targets, and isolated execution environments.

The first release is delivered in phases ([backlog](backlog.md)). **Phase 1 (MVP)** ships a standard agent Bot: Bots with profiles and memory, parallel Runs up to the cap with steering and cancellation, files and commands with grants, Always allow for commands and folders, `web_search` and `web_fetch`, durable approvals and receipts, compaction, and a signed installable build. Phase 2 adds connectors, skills, routines, the rest of Auto Review, group chats, handoff, and templates. Phase 3 adds the managed browser, desktop computer use, voice, and teach-a-task. The contracts in this document cover all phases so that later ones attach without reworking Phase 1.

## 10. Development Sequence and Milestone Acceptance

Each milestone requires a verifiable result before the next builds on it. These are planned implementation steps; [the technical plan](technical-plan.md) breaks each one into ordered work and records progress.

| Milestone | Development work | Completion criteria |
| --- | --- | --- |
| M0: Workspace and Pi baseline | Workspace and import-boundary check; `protocol` with `targetId`; Pi import with Section 2 provenance and assets; pinned Node runtime | Pi packages resolve only from the workspace; required builds and checks pass; a minimal conversation persists and reopens using temporary SQLite |
| M1: Host and local execution | `apps/local-server`, `server-core`, `agent-runtime`, `tool-router`, `local-executor`; file and command tools; grants and basic policy; per-conversation queue; receipts; cancellation; replay rules | Through a local harness, a real-model task creates and reads a file in an authorized temporary directory; unauthorized paths fail; a non-local `targetId` is rejected; command output, exit status, and receipts are stored; a Host restart during an approval resumes the same approval without duplicate execution |
| M2: Desktop | Electron UI, preload, main, private IPC, Bot roster, conversations, approvals, settings with Keychain credentials, notifications, menu-bar lifecycle, reconnect | The UI completes M1; closing and reopening the window preserves the Run view; the renderer cannot invoke the executor or read stored secrets |
| M3: Managed browser and web | `packages/browser`, browser tools, takeover, secret requests and filling, `web_search`, `web_fetch` | A Bot researches a topic in its own window and saves a report; a manual login through takeover is reused by a later task; secret values never appear in the transcript or model input |
| M4: Multiple Bots | Bot memory, parallel Runs with a cap, group chats, handoff, templates, usage | Two Bots work in parallel in separate browser windows; a handoff runs exactly once after a Host restart; cancelling one Bot leaves the other running |
| M5: Skills, routines, and Auto Review | Skill library and `/` attachment, `skill_save`, routine scheduler, test runs, catch-up, policy rules, model reviewer, approval expiry | A routine fires on schedule, posts a report, and deduplicates a duplicate firing; an unattended approval expires without running; Ask first overrides Allow automatically |
| M6: Desktop computer use | `packages/computer-use` with native helper, permission status, desktop tools, control lease, pause shortcut, handback | A Bot operates a desktop application; pause blocks further input; permission denial and display changes are handled; resume starts from a fresh capture; a second Bot's desktop input waits for the lease |
| M7: Connectors | MCP connector supervisor, OAuth and Keychain credentials, deferred tools and tool search, `@` attachment | A Bot uses a connector tool through Tool Router with receipts; the connector's credential is absent from other command environments |
| M8: Voice and teach-a-task | Composer dictation; browser recording to a draft skill | A recorded browser workflow produces a reviewable draft skill without password field values |
| M9: Recovery and packaging | Termination of each process, lock, sleep, and wake, duplicate delivery, consistent backup, upgrades, bundled runtime, packaged permissions | Section 11 passes on a real Mac using the packaged application, with unsupported or unverified boundaries recorded |

Permissions, policy, and execution records are part of M1 from the start. Use Pi's existing affected tests where appropriate and add focused protection for high-risk lifecycle or authorization gaps. Static skills are explicitly loaded by OpenBot; `pi-coding-agent` extension loading is not provided by Durable.

## 11. First-Release Acceptance Scenarios

1. **All OpenBot processes are local:** A Bot reads a selected file, researches in the managed browser, and saves a report locally. Execution records identify this installation, user session, Bot, and local `targetId`. Model inference may still use a configured remote API.
2. **Permission scope is visible and enforced:** Unauthorized file paths, stale approvals, and revoked grants fail. Commands, browser control, desktop control, and connectors are authorized separately. Other targets are rejected. Denied macOS permission produces a useful status.
3. **Policy precedence holds:** Ask first wins over Allow automatically; the model reviewer can only escalate; Always allow creates exactly the confirmed rule; unattended approvals expire without running.
4. **Bots work in parallel without interfering:** Two Bots run concurrently in separate browser windows; desktop input from one waits for the lease held by the other; shared logins work for both.
5. **Human control takes priority:** Takeover gates the Bot's window; pausing during a sequence of desktop actions blocks further input; continuation starts from a fresh snapshot or capture.
6. **Secrets stay out of model input:** Secret requests, secret filling, and connector credentials never appear in transcripts, model requests, logs, or unrelated command environments.
7. **Routines are predictable:** A routine runs on schedule, deduplicates repeated firing, coalesces occurrences missed during sleep, records each run, and reports failures instead of using stale data.
8. **Application lifecycle is predictable:** A closed window leaves work running; quitting stops supervised work or records an uncertain outcome; sleep, wake, lock, and unlock never silently reuse stale desktop control.
9. **Submission and execution deduplicate:** Resubmitting a message, retransmitting an invocation or result, replaying a handoff, or re-firing a routine does not create duplicate work or repeat a confirmed side effect.
10. **Cancellation preserves unrelated work:** Cancelling one Run propagates to its executor operations while other Bots and queued messages continue. Unconfirmed termination is visibly distinct from cancellation.
11. **Interrupted effects remain explicit:** After a crash between an action and its result recording, OpenBot reconciles the receipt or requires user attention. It never automatically repeats an unsafe action.
12. **The packaged application uses the intended runtime:** The bundled Node, Pi sources and assets, native helper identity, OS permissions, browser launch, store ownership, and clean relaunch are verified on macOS.
13. **State restores from backup:** Conversation state, Bot profiles and memory, routines, artifact references, skills, and execution records recover consistently, with application, Pi, and data-format versions recorded.

The Pi source baseline and interfaces above were checked against upstream revision `b45e0ebcc` in a local checkout on 2026-10-14. Tool permissions, browser and macOS integration, crash recovery, real-model behavior, and packaged distribution remain implementation and acceptance work.

### Local usage evidence (B13d)

Desktop-only `usage.get({ botId, limit? })` projects a live Bot's Pi model usage and at most 50 recent Runs through the agent-runtime adapter. Model-facing application capabilities are unchanged. A local version-1 `openbot.usage-evidence` document records cumulative-counter baselines atomically with Run admission and freezes their deltas atomically with terminal settlement. An interrupted interval remains live until `interruption.settledAt`; interruption intent alone cannot freeze late committed usage. Replays do not re-add usage; compaction is already included in Pi's model ledger, and tool/Code Mode child buckets are not added again. Per-Bot token totals include older retained conversation data even after recent Run details are pruned.

Estimates use recorded Pi cost counters only with known admission-time rates and an unchanged pricing epoch. Re-reading identical model configuration through observation preserves that epoch; changing configuration or model selection invalidates it. Configured providers require explicitly complete nonnegative rates, including explicit tiers where applicable. Legacy/unattributed or active intervals spanning a configuration change/restart show unavailable prices. Completed estimates remain frozen; these figures are not provider billing reconciliation. Provider/model identifiers and source class may be shown locally; endpoints, credentials, prompts and tool content are excluded from the usage payload and operation audit. Private timeline links and published group result links reuse existing navigation; reading the projection does not advance a read cursor.

### Local privacy and operation diagnostics

Product stores, transcripts, memory, configuration and diagnostics stay on the Mac. There is no automatic analytics or log upload. Configured model and search services receive task-relevant inputs; local storage does not imply offline inference. Credentials stay in Keychain or explicitly configured local credential sources. B16 adds allowlisted operation diagnostics (generated ID, method, time, duration, outcome) to the bounded local Host log, excluding inputs, outputs, Prompt, memory and credential material. Authoritative Runs, approvals and execution receipts remain separate durable records.

### Product foundation integration (I1)

[I1](tasks/i1-product-foundation.md) validates observation, artifacts, lifecycle, policy and usage together. `artifact_publish` is a file-read capability with a dedicated bounded Ask first predicate in the settings selector. Publication's canonical source participates in read-grant revocation and executor revision fences. A stale invocation cannot create a new copy; a verified immutable publication receipt can reconcile after source removal without renewed file authority. The copy is not rolled back by cancellation. Private executor IPC retains correlated, target-bound artifact, quiescence and policy-control exchanges with bounded waits.

### Unattended reliability (B11d)

`Group.revision` and `Routine.revision` protect edits. Optional `deliveryRevision` and `executionRevision` protect report destinations and source workflow bindings; legacy records fall back to `revision`. A name-only update preserves the semantic version and existing occurrence/input snapshots. Other updates retain conservative invalidation. `reportTo.groupRevision` is a delivery version, and occurrence/report-input revisions are execution versions. Desktop editors and structured group-management results carry these optional fields.

Routine reconciliation isolates each occurrence and each due schedule. Failures retry with original identities and exponential delays from two to sixty seconds. `routines.list.scheduler` reports process-local fault identities, failure/retry times, attempt counts and the last successful scan; diagnostics never contain prompts or raw provider errors. Startup rebuilds diagnostics by reconciliation. Global preparation/storage failure blocks the scan; a bad individual record cannot block healthy work or Host readiness. Durable Runs, occurrences and publication receipts remain authoritative.

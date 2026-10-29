# B7: Desktop MVP

Status: done (Phase 1 MVP merged; see task index)
Branch: task/b7-desktop-mvp
Depends on: B2 (Runs: `RunScheduler`, `run` on snapshots), B6 (memory, thinking level), B8 (`app://`, fuses)
Architecture: Sections 6.1 (desktop protocol, `conversations.subscribe`, `bots.delete`), 6.4 (named methods, schema validation, coalescing, `powerSaveBlocker`), 8.3 (deleted Bots keep their conversation)

## Goal

Make the desktop app something a daily user can start and keep using: a first launch that ends with a working model and a first Bot, a transcript that stays readable when a Bot runs many tools, the macOS signals people expect (notifications, dock badge, staying awake while Bots work), Duplicate and Delete in the Bot menu, and IPC that rejects malformed calls before they reach the Host. Streaming must stay cheap as the roster grows, so only the conversation on screen streams.

## Scope

In:
- Onboarding: provider presets Anthropic, OpenAI, OpenRouter (built-in Pi provider IDs `anthropic`, `openai`, `openrouter`) and "Other (OpenAI-compatible)" with name, base URL, model ID, and key; key to the Keychain; a real test request; default model; "Meet your first Bot" with Research, Coding, Writing roles.
- `models.addProvider`, `models.test`, `conversations.subscribe`, `bots.duplicate`, `bots.delete`, `files.resolveReveal` Host methods.
- `conversation.updated` only for the subscribed Bot, coalesced per Bot to one per 50 ms (first at once, trailing latest).
- Transcript: "Ran N steps" folding, Copy on code blocks, Reveal in Finder for `local_write` / `local_edit` paths, message times on hover.
- Notifications for new approvals and finished or failed Runs while unfocused; click opens the Bot. Dock badge = pending approvals across Bots.
- `powerSaveBlocker("prevent-app-suspension")` while any Bot is `working` or `queued`.
- TypeBox parameter schemas for every Host method in `protocol`, checked in Electron main and in the Host.

Out:
- Sequence-gap recovery, backpressure, `Cmd+K`, menu-bar Pause all, transcript virtualization, login item: B14.
- Granted folders as Reveal roots: B5 grants land separately; `files.resolveReveal` takes a list of roots so the integration adds them (see Open questions).
- Exporting or permanently erasing a deleted Bot's data: later (architecture 8.3 removal flow).

## Design

### Onboarding condition

The renderer shows the setup screen when, on its first load, there is **no default model, no Bot, and no provider whose `configured` flag is set** (a stored key, or a configuration-file provider whose key resolves). The decision is taken once per window (`onboarding` in the store), so a Host restart never restarts the flow. Alternatives: "no default model" alone would trap users who deleted the default; "no Bot" alone would show setup to users with a configured `models.json`.

Because a configured `models.json` provider skips onboarding, the e2e harness keeps working unchanged: it writes the scripted provider by default. `launchApp(name, { firstLaunch: true })` writes no `models.json` and exposes `modelBaseUrl` for the onboarding suite.

Presets store the key with `credentials.set` under the built-in provider ID; the model list comes from `models.list` (preselecting a known good model). "Other" writes a provider entry with `models.addProvider` (API `openai-completions`), then stores the key under the same ID. The key is required: pi-ai's OpenAI-compatible client refuses to send a request without one (`No API key for provider`), and local servers accept any placeholder. The **Test** step calls `models.test`; only on success does it set the default model and continue.

### Keys for configuration-file providers

`packages/agent-runtime/src/model-config.ts` resolves a declared provider's key in this order: a credential stored in the Keychain under the provider ID, then the configured `apiKey`, then no key. So a provider `models.addProvider` declared (without `apiKey`) uses the Keychain key once `credentials.set` stored one (verified by the smoke: the fake server saw `Authorization: Bearer <stored key>`). `RedactedSettings` reports such providers as `source: "config"`, `configured: true`, and `keyStored` from the Keychain index; without a stored key, `models.test` reports pi-ai's `No API key for provider` error. The file never receives a key: `models.addProvider` has no key field, and a URL with user info is refused.

### Merging `models.json`

`mergeProvider` (server-core) parses the current text as plain JSON, keeps every other top-level field and provider, and replaces only `providers[id]` with `{ name, baseUrl, api, models: [{ id }] }`. A file with comments (allowed by the reader) is refused with "add the provider there by hand" instead of being rewritten without them. IDs of built-in providers are refused (they would become overlays with different semantics). The Host writes atomically (temporary file and rename, mode 0600). The next settings read reloads the configuration, as before.

### One-shot completion

`BotRuntime.testModel(ref)` looks up the model in the same `MutableModels` collection Bots use (so overlays, configured headers, and the Keychain apply), calls pi-ai `completeSimple` with one user message, `maxTokens: 16`, and a 30 s abort signal, and maps every failure (unknown model, missing key, HTTP error, timeout, thrown setup errors) to `{ ok: false, error }`. No Pi type crosses the package boundary.

### Subscription and coalescing

`ConversationFeed` (server-core) holds the single subscribed Bot and a `Coalescer<BotId, ConversationSnapshot>`. `HostService.#publish` still computes activity and settles tool calls for every Bot; it hands the view to the feed, which drops other Bots' snapshots. The coalescer is a leading-plus-trailing throttle per key: the first value after a quiet window goes out at once; later values in the window replace each other; when the window closes the latest goes out and opens the next window. Switching the subscription cancels the old Bot's held value, and delivery checks the key is still subscribed, so a stale snapshot never reaches the renderer. The renderer subscribes in `openBot` (then fetches a snapshot), and `loadAll` reopens the current Bot after every Host restart, which re-subscribes.

Because other Bots no longer stream, everything main needs comes from the roster: `BotSummary` gains `pendingApprovals` and `lastRun` (the Bot's newest Run since the Host started, terminal ones included, from `RunScheduler.latest`). The Host emits `bots.changed` whenever activity, the approval count, or the latest Run's ID or state changes.

Alternatives: a per-client subscription set was unnecessary (one renderer); coalescing in main would still pay for serializing every snapshot across the Host IPC.

### Main: attention, notifications, power

`attention(previous, next)` (pure, `apps/desktop/src/main/attention.ts`) returns the badge, whether to keep the Mac awake, and notices: a new approval (count grew) and a Run newly `completed` or `failed` (cancelled is the user's own action). The first roster after a (re)start is a baseline and never notifies. `AttentionWatcher` fetches `bots.list` after each `bots.changed` (one fetch at a time, one follow-up if more changes arrive), applies `app.dock.setBadge`, starts or stops `powerSaveBlocker`, and shows `Notification`s only while no OpenBot window is focused. Clicking shows the window and sends `openbot:open-bot` to the renderer, which opens the Bot. The session permission handler still denies web notifications; these are main-process notifications.

### Transcript

`transcriptRows(items, awaitingApproval)` folds runs of two or more consecutive `succeeded` tool items not waiting for approval into one `steps` row keyed by its first call's ID (so expansion state survives growth). Failed, interrupted, cancelled, running, pending, and awaiting-approval rows always stay their own row. Code blocks render with a Copy button; the session denies `clipboard-sanitized-write`, so copying goes through a narrow main channel (`copyText`, string only, size-capped). Reveal in Finder (`revealPath`) shows on succeeded `local_write` / `local_edit` rows; main validates the argument with the `files.resolveReveal` schema, asks the Host for the canonical path, and calls `shell.showItemInFolder` only on a non-null answer. The Host resolves symbolic links and accepts only existing paths inside the roots (the workspace today). Pi stamps every message, so user and assistant transcript items carry `at` (epoch ms), shown on hover.

### Duplicate and Delete

`bots.duplicate { botId, requestId }` creates `bot_<requestId>` named "<name> (copy)" with the same role, instructions, model, and thinking level, and the source's memory written in the same commit that registers the Bot; no history. Same `requestId`, same Bot.

`bots.delete { botId }` cancels the Bot's active Run (queued or running) through the scheduler and waits for it, marks the profile `deleted`, stops observing it, and clears the subscription if it pointed there. Deleted Bots are left out of `bots.list`, not observed after a restart, and refused by every Bot method (`not_found`). The Pi conversation and memory stay in the database (architecture 8.3: removal of stored data is a separate step). `bots.update` cannot set `deleted`.

### IPC validation

`packages/protocol/src/schemas.ts` defines `HOST_PARAM_SCHEMAS` (TypeBox, `additionalProperties: false`) for every `HostMethod`, typed `satisfies { [M in HostMethod]: TSchema }` so a new method fails type checking until it has a schema, plus a compile-time check that each schema's static type is assignable to the method's params. `paramsError(method, params)` returns a message naming fields, never values. Electron main validates before forwarding (also the reveal channel); the Host validates every request before dispatch. Invalid → `invalid_request`. `protocol` gains its only dependency, `typebox@1.3.27` (the exact version vendored Pi uses), exported from the subpath `@openbot/protocol/schemas` so type-only users do not load it. `MODEL_APIS` moved from agent-runtime into protocol so the schema and the configuration reader share it.

## Contracts

```ts
// packages/protocol
export const MODEL_APIS = ["openai-completions", "openai-responses", "anthropic-messages"] as const;
export type ModelApi = (typeof MODEL_APIS)[number];
BotProfile.status: "active" | "hidden" | "deleted";
BotSummary = BotProfile & {
	activity: BotActivity;
	pendingApprovals: number;
	lastRun?: Pick<RunRecord, "runId" | "state" | "error">;
};
TranscriptItem user / assistant: at?: number; // epoch ms

// HostMethods additions (appended to HOST_METHODS)
"models.addProvider": { params: { id; name; baseUrl; api: ModelApi; modelIds: readonly string[] }; result: RedactedSettings };
"models.test": { params: ModelRef; result: { ok: boolean; error?: string } };
"conversations.subscribe": { params: { botId: BotId | null }; result: null };
"bots.duplicate": { params: { botId: BotId; requestId: string }; result: BotProfile };
"bots.delete": { params: { botId: BotId }; result: null };
"files.resolveReveal": { params: { path: string }; result: string | null }; // main-only, not in RENDERER_METHODS
"bots.update".params.status?: "active" | "hidden";

// packages/protocol/schemas (subpath export)
export const HOST_PARAM_SCHEMAS: { readonly [M in HostMethod]: TSchema };
export function paramsError(method: HostMethod, params: unknown): string | undefined;
export const PROVIDER_ID_PATTERN = "^[a-z0-9][a-z0-9._-]{0,63}$";

// packages/agent-runtime
BotRuntime.testModel(ref: ModelRef, timeoutMs?): Promise<{ ok: boolean; error?: string }>;
CreateBotInput gains thinkingLevel?, memory?;

// packages/server-core
ModelConfigFile gains write(text): Promise<void>;
HostServiceOptions gains coalesce?: { windowMs?; timers? };
RunScheduler.latest(botId): RunRecord | undefined;
export class Coalescer<K, V>, ConversationFeed, COALESCE_WINDOW_MS = 50;

// apps/desktop shared/api.ts
OpenBotApi gains copyText(text), revealPath(path), onOpenBot(listener);
CHANNELS gains copyText, revealPath, openBot.
```

Invariants:
- Desktop receives `conversation.updated` only for the subscribed Bot; per Bot at most one per window; the last snapshot pushed is delivered unless the subscription moved away.
- No key is ever written to `models.json`; other entries survive `models.addProvider`.
- A deleted Bot has no running work, no observer, and no entry in `bots.list`; its conversation remains stored.
- Every Host method has a schema; main and the Host both reject params that fail it.
- Reveal only shows existing paths inside the workspace after link resolution.

## Steps

1. Protocol types, methods, `schemas.ts`, `typebox` dependency; schema unit tests.
2. agent-runtime: timestamps on transcript items, `testModel`, `createBot` with thinking level and memory; `MODEL_APIS` from protocol.
3. server-core: `Coalescer`, `ConversationFeed`, `mergeProvider`, `revealablePath`, `RunScheduler.latest`, HostService handlers and roster fields; unit tests.
4. local-server: schema check before dispatch; atomic `models.json` write.
5. Desktop main: schema check in IPC, `copyText` and `revealPath` channels, `AttentionWatcher` (badge, notifications, power); `attention` unit tests.
6. Renderer: subscribe on open and after Host restart, onboarding, steps folding, Copy, Reveal, times, Duplicate and Delete; `transcriptRows` unit tests.
7. E2E `e2e/desktop-mvp.e2e.ts`; harness `firstLaunch` option and `modelBaseUrl`.

## Acceptance

1. Onboarding with a custom endpoint, test request, first Bot: e2e `desktop-mvp.e2e.ts › sets up a custom OpenAI-compatible provider…` (passes in CI). Host level: smoke `models.addProvider` / `models.test` checks; unit `host-service.test.ts › adds a custom provider…`, `› tests a model…`.
2. Only the subscribed Bot streams, coalesced: unit `conversation-feed.test.ts` (deterministic timers), `host-service.test.ts › sends conversation updates only for the subscribed Bot`; smoke "updates coalesced" and "only the subscribed Bot".
3. Collapsed steps: unit `steps.test.ts`; e2e `› collapses consecutive successful tool calls…` (also Copy and Reveal).
4. Duplicate and Delete: unit `host-service.test.ts › duplicates…`, `› deletes a Bot…`; e2e `› duplicates a Bot … deletes one after confirmation`; smoke checks.
5. Schema rejection: unit `schemas.test.ts`; e2e `› rejects a schema-invalid call in main`; smoke "Host rejects …".
6. Notifications, badge, power transitions: unit `attention.test.ts`. Real macOS notification delivery and the power assertion need the packaged app (not verified here).
7. `pnpm run check` green.

## Risks

- **Missed updates for a background Bot.** By design the renderer has only the selected conversation; switching fetches a fresh snapshot. If something else in the renderer starts reading other conversations, it must fetch them.
- **Notification noise.** A Bot that alternates approvals can notify often; each notice needs an actual change in the roster. Tune after real use.
- **`models.json` with comments.** Refused rather than rewritten; the message tells the user to edit it by hand.
- **Clipboard channel.** Any trusted-frame caller can write the clipboard; it is size-capped and string-only, and only the app's own document is trusted.

## Open questions

2026-10-15 (execution notes, decided locally):
- The Host method for Reveal is `files.resolveReveal { path } → string | null` (canonical path or null) rather than a boolean, so main reveals exactly the path the Host checked. It is not in `RENDERER_METHODS`; only main calls it.
- Granted folders (B5) are not Reveal roots in this branch; `revealablePath(path, base, roots)` takes the roots list, and the integration should pass the workspace plus `loadPolicy(...).grants` lists.
- B5's methods (`policy.*`, `grants.*`, and the `always_allow` decision object) need schema entries when B5 and B7 are merged; the `satisfies` clause makes the merge fail type checking until they exist.
- The e2e suite was not run locally in this batch (no Electron launches); it passed in CI on the integrated branch, and a Host-level smoke script exercised the Host methods.

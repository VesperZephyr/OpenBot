# B6: Bot Quality and Memory

Status: done (Phase 1 MVP merged; see task index)
Branch: task/b6-bot-quality
Depends on: none
Architecture: Sections 4.4 (Pi integration: sections, documents, reset, compaction), 5.1 (Host tools), 5.7 (memory), 6.1 (`bots.memory.*`)

## Goal

Make a Bot feel like a teammate rather than a raw model: a system prompt that says who it is and how it works, a memory that survives restarts and new topics, a thinking level for reasoning models, long conversations that keep working (compaction), a **New topic** action, and a **Retry** for model errors. MVP acceptance items 5 (preference persists across a new topic and restart) and 8 (compaction) depend on it.

## Scope

In:
- Prompt sections in the OpenBot Pi extension: identity, working style, tool surface, memory.
- `openbot.memory` document, `memory_update` Host tool, `bots.memory.get` / `bots.memory.update`, Memory tab in Edit profile.
- `thinkingLevel` per Bot, thinking blocks in the transcript.
- Transcript dividers for `pi.compaction` and `pi.reset`; **New topic** (`conversations.reset`).
- **Retry** on an assistant error item.

Out:
- `web_search` itself (B4); the prompt only describes it.
- Runs, steering, and the `messages.submit` result shape (B2). Retry reads no result field.
- Always allow (B5), background tasks and truncation spill (B3): the prompt describes only what exists.
- Duplicate with memory (B7).

## Design

### Prompt sections

Pi renders the selected extensions' sections in order before each request and stores them as positional system entries; only changed sections are sent again (Pi README, "System Prompt"). Each section therefore depends only on inputs that change rarely. One extension, `openbot.bot`, always installed, carries the sections and (when the Host passes an invoker) the routed tools:

| Key | Content | Changes when |
| --- | --- | --- |
| `identity` | Bot name and label from `openbot.bots`, "a Bot in OpenBot on the user's Mac", today's date (local `YYYY-MM-DD`, no time) | rename, relabel, date |
| `working_style` | Adapted from Grok Bot's prompt (sections 1.1 to 1.5, 1.7, 1.20): reply first with a short acknowledgment before tool work, short progress updates on meaningful beats, plain prose over outlines, decide and proceed (ask only when blocked or before something destructive), report what was done and what was not verified, never invent facts | never |
| `tools` | Workspace first; search files with `rg` (else `grep`/`find`) through `local_exec`; commands need approval and a denial means adjust; `web_search` then `web_fetch`, cite pages opened, not snippets, prefer primary sources, a search miss does not prove absence | never (only with tools) |
| `memory` | How to use `memory_update`, then the Bot's memory or "(empty)" | memory edit |

Sections read documents through `input.read.snapshot` (Pi README, "Your Own State"); an absent document renders as its default. The Bot's `instructions` keep rendering last as Pi's `instructions` section.

### Memory storage

A Session-scoped document family `openbot.memory` keyed by `botId`, value `{ content: string }`. Alternatives: a conversation-scoped document on the Bot's conversation would be simpler to read from a section, but memory belongs to the Bot, not to one conversation: subagent or group conversations a Bot uses later must see the same memory, and a fork would restart it. A Session family keeps one atomic value per Bot in the same store as `openbot.bots`. Rendering resolves the Bot from the conversation through `openbot.bots` (as tools already do).

Memory is Markdown of at most 8 KB (UTF-8 bytes, `MEMORY_LIMIT_BYTES`). `##` headings split it into sections; text before the first heading is kept as is. `memory_update { action: "replace" | "append", section, content }` edits one section in a single commit:
- `replace` sets the section body; empty content removes the section.
- `append` adds the content as a new line unless the section already contains it, which also makes a rerun after a restart a no-op (the tool is replay-safe through the router, so it must be idempotent).
- A missing section is created at the end. A result above 8 KB fails with an actionable message and changes nothing.

The tool goes through Tool Router like every Host tool, with a new capability `"memory"` that policy always allows. Host tool handlers gain the call (`botId`) as a third argument, since memory is per Bot.

### Thinking

`BotProfile.thinkingLevel?: "off" | "low" | "medium" | "high"`; `bots.update` stores it and calls Pi `configure({ thinkingLevel })`. Edit profile shows the select only when the effective model (the Bot's, else the default) has `reasoning`. Assistant `thinking` blocks (not redacted ones) are projected as `thinking?: string` and shown collapsed.

### Compaction, reset, and the transcript

Pi auto-compaction stays on with its defaults (`reserveTokens` 16384). Pi's view holds only the active context: the head marker (a `pi.reset` with `head` = itself, or a `pi.compaction` whose `head` is the first kept entry), then the entries from that head. To keep earlier messages visible, the projection adds the entries before the head, read once per head marker with `conversation.entries()` (entries are immutable), plus earlier markers hidden from the view, and orders everything by entry ID. `pi.compaction` projects as `{ kind: "divider", reason: "compaction" }` ("Earlier messages summarized"), `pi.reset` as `reason: "reset"` ("New topic").

**New topic** in the Bot menu calls `conversations.reset { botId }` → Pi `conversation.reset(undefined)`. Pi queues the reset while the Bot is busy. Memory is a document, so the next request's system prompt still carries it.

### Retry

The newest assistant item with an `error`, when no Run is live, gets **Retry**, which submits the text of the last user item before it through `messages.submit` with a fresh `requestId`.

## Contracts

```ts
// packages/protocol
export type ThinkingLevel = "off" | "low" | "medium" | "high";
export const MEMORY_LIMIT_BYTES = 8192;
BotProfile.thinkingLevel?: ThinkingLevel;
TranscriptItem assistant: thinking?: string;
TranscriptItem: { kind: "divider"; id: string; reason: "compaction" | "reset" };
ToolCapability: ... | "memory";
"bots.update" params: thinkingLevel?: ThinkingLevel;
"bots.memory.get": { params: { botId }; result: { content: string } };
"bots.memory.update": { params: { botId; content: string }; result: { content: string } };
"conversations.reset": { params: { botId }; result: null };
TOOL_CATALOG: memory_update { action: "replace" | "append"; section: string; content: string }, capability "memory", destination "host".

// packages/tool-router
HostToolHandler = (args, signal, call: ToolCall) => Promise<ToolOutcome>;

// packages/agent-runtime: BotRuntime gains
memory(botId): Promise<string>;
setMemory(botId, content): Promise<string>;            // invalid_request above the limit
editMemory(botId, edit: MemoryEdit): Promise<string>;  // same
reset(botId): Promise<void>;
```

Document: `openbot.memory` v1, Session family, key `botId`, `{ content: string }`.

## Steps

1. Spec (this file).
2. Protocol types, catalog entry, methods; desktop allowlist.
3. agent-runtime: `memory.ts` (document, section edit), sections in `prompt.ts`, extension wiring, thinking level, history-aware projection with dividers, `reset`. Unit tests in `test/bot-quality.test.ts`.
4. Tool Router third handler argument; policy `memory` allow; server-core `memory-tool.ts` and Host methods; local-server wiring.
5. Desktop: Memory tab (`ProfileMemory.tsx`), thinking select, thinking block, dividers, New topic, Retry, "Updated memory" row.
6. E2E `e2e/bot-quality.e2e.ts`.

## Acceptance

1. Memory persists across reopen and appears in the next request's system prompt: unit `bot-quality.test.ts › memory_update persists across reopen and reaches the next system prompt`.
2. The 8 KB limit rejects an edit and keeps the old content: unit `› rejects memory above 8 KB`; section edits: unit `› edits memory sections`.
3. Reset: the next request has no earlier messages but keeps memory; the transcript keeps earlier messages and shows a reset divider: unit `› reset starts a new context that keeps memory`.
4. Compaction with default settings on a small context window projects a compaction divider and keeps earlier messages visible: unit `› projects a compaction divider and keeps earlier messages`.
5. Thinking blocks are projected: unit `› projects thinking`.
6. E2E `bot-quality.e2e.ts › memory_update shows in the Memory tab and the next system prompt` (also checks a user edit in the Memory tab reaches the next request); `› New topic shows a divider and drops earlier messages but keeps memory`; `› Retry resubmits the last message after a model error` (uses a new additive `{ error }` turn in `ScriptedModel`).
7. Compaction is covered by the unit test (acceptance 4) rather than e2e: the e2e model is served through `models.json`, and a tiny window there would compact every other suite's turns too.

## Risks

- Prompt quality is only checked with scripted models here; a real-model spot check with two providers is still needed.
- Loading history before the head reads the whole older transcript once per head change; very long histories cost one scan per compaction or reset, not per update.

## Open questions

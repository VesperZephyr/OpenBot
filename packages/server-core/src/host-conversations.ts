import type { BotRuntime } from "@openbot/agent-runtime";
import {
	ProtocolError,
	type BotActivity,
	type BotId,
	type ConversationSnapshot,
	type HostParams,
} from "@openbot/protocol";
import { fixedActivity } from "./activity.ts";
import type { ApprovalBook } from "./approvals.ts";
import type { BackgroundTasks } from "./background.ts";
import type { BotManagement } from "./bot-management.ts";
import type { ConversationFeed } from "./conversation-feed.ts";
import type { EventSink } from "./host-ports.ts";
import type { Groups } from "./groups.ts";
import type { RunScheduler } from "./runs.ts";

export type ObserverState = {
	stop: () => void;
	activity: BotActivity;
	last?: ConversationSnapshot;
	/** Approval count and latest Run last announced with `bots.changed`. */
	roster?: string;
};

export type ConversationHost = {
	readonly runtime: BotRuntime;
	emit: EventSink;
	liveBot(botId: BotId): Promise<import("@openbot/protocol").BotProfile>;
	readonly runs: RunScheduler;
	readonly approvals: ApprovalBook;
	readonly observers: Map<BotId, ObserverState>;
	readonly feed: ConversationFeed;
	readonly background: BackgroundTasks;
	readonly groups: Groups;
	toolSettled(botId: BotId, callId: string, conversationId?: string): void;
	readonly management: BotManagement;
};

/** Live attention is separate from the durable unread cursor used by the roster. */
export function nextActivity(snapshot: ConversationSnapshot): BotActivity {
	if (snapshot.approvals.length > 0 || snapshot.attention || snapshot.run?.state === "needs_attention") return "needs_attention";
	const sinceUser = snapshot.items.slice(snapshot.items.findLastIndex((item) => item.kind === "user") + 1);
	if (sinceUser.some((item) => item.kind === "tool" && item.status === "interrupted")) return "needs_attention";
	if (snapshot.live !== undefined) return "working";
	if (snapshot.run?.state === "queued") return "queued";
	return "idle";
}

function withApprovals(host: ConversationHost, snapshot: ConversationSnapshot): ConversationSnapshot {
	const approvals = host.approvals.forBot(snapshot.botId, snapshot.conversationId);
	if (approvals.length === 0) return snapshot;
	const live = snapshot.live === undefined ? undefined : { ...snapshot.live, state: "waiting_approval" as const };
	return { ...snapshot, approvals, ...(live === undefined ? {} : { live }) };
}

/** A queued Run's messages are not in Pi yet; they show as pending until the Run starts. */
function withRun(host: ConversationHost, snapshot: ConversationSnapshot): ConversationSnapshot {
	const stored = host.runs.active(snapshot.botId, snapshot.channelId) ?? host.runs.attention(snapshot.botId, snapshot.channelId);
	if (stored === undefined) {
		const retry = !snapshot.channelId ? host.runs.retry(snapshot.botId) : undefined;
		if (retry) return { ...snapshot, retry };
		return snapshot;
	}
	const { messages, inputs: _inputs, ...run } = stored;
	if (stored.messageMode) snapshot = { ...snapshot, messageMode: true, ...(snapshot.live ? { live: { ...snapshot.live, partial: [], ...(snapshot.live.retry ? { retry: { ...snapshot.live.retry, error: "The model request will be retried." } } : {}) } } : {}) };
	if (run.state !== "queued") return { ...snapshot, run, ...(run.state === "running" && !run.interruption ? { live: { ...(snapshot.live ?? { state: "running" as const }), activity: { runId: run.runId, labelKey: fixedActivity(host.runtime.execution.current.get(run.runId)) } } } : {}) };
	const queued = messages.map(({ requestId, text, attachments, skills }) => ({
		id: requestId,
		...(stored.origin === "background" ? { source: "background" as const } : {}),
		parts: [{ type: "text" as const, text }],
		...(attachments ? { attachments } : {}),
		...(skills ? { skills: skills.map(({ name, revision, sha256 }) => ({ name, revision, sha256 })) } : {}),
	}));
	return { ...snapshot, run, pending: [...(snapshot.pending ?? []), ...queued] };
}

/** The runtime's snapshot with what the Host adds: pending approvals and the Bot's current Run. */
export function projectConversation(host: ConversationHost, snapshot: ConversationSnapshot): ConversationSnapshot {
	return { ...withRun(host, withApprovals(host, snapshot)), backgroundTasks: host.background.view(snapshot.botId, snapshot.conversationId) };
}

function publishConversation(host: ConversationHost, botId: BotId, state: ObserverState, snapshot: ConversationSnapshot): void {
	state.last = snapshot;
	const view = projectConversation(host, snapshot);
	const before = state.activity;
	state.activity = nextActivity(view);
	// The roster also carries the approval count and the latest Run, which Desktop main turns into the dock badge,
	// notifications, and the power assertion.
	const latest = host.runs.latest(botId);
	const message = view.items.findLast(
		(item) => (item.kind === "user" || item.kind === "assistant") && item.parts.some((p) => p.text.trim()),
	);
	const roster = `${view.approvals.length}|${latest?.runId ?? ""}|${latest?.state ?? ""}|${message?.id ?? ""}|${view.readCursor ?? 0}`;
	if (state.activity !== before || roster !== state.roster) host.emit({ type: "bots.changed", payload: {} });
	state.roster = roster;
	host.feed.publish(view);
}

export function republishConversation(host: ConversationHost, botId: BotId): void {
	const state = host.observers.get(botId);
	if (state?.last !== undefined) publishConversation(host, botId, state, state.last);
}

export async function observeBot(host: ConversationHost, botId: BotId): Promise<void> {
	if (host.observers.has(botId)) return;
	const state: ObserverState = { stop: () => {}, activity: "idle" };
	host.observers.set(botId, state);
	state.stop = await host.runtime.observeLive(botId, (snapshot) => publishConversation(host, botId, state, snapshot), (outcome) => {
		if (outcome.tool.startsWith("group_") || outcome.tool.startsWith("app_groups_")) void host.groups.settled(botId, outcome.id, outcome.status).catch(() => {});
		if (["bot_create", "bot_update", "bot_delete"].includes(outcome.tool) || outcome.tool.startsWith("app_bots_")) void host.management.settled(botId, outcome.id, outcome.status).catch(() => {});
		host.toolSettled(botId, outcome.id, outcome.conversationId);
	});
}

export async function markConversationRead(host: ConversationHost, params: HostParams<"conversations.markRead">): Promise<null> {
	const { conversationKey, through } = params;
	if (conversationKey.startsWith("bot:")) await host.liveBot(conversationKey.slice(4));
	else if (!conversationKey.startsWith("group:") || !(await host.runtime.groups().get(conversationKey.slice(6))))
		throw new ProtocolError("not_found", "Conversation is unavailable");
	if (await host.runtime.conversationIndex().markRead(conversationKey, through))
		host.emit({ type: conversationKey.startsWith("bot:") ? "bots.changed" : "groups.changed", payload: {} });
	return null;
}

export async function submitMessage(host: ConversationHost, params: HostParams<"messages.submit">) {
	const { botId, requestId, text, artifactIds, skills } = params;
	if (text.trim() === "" && !artifactIds?.length && !skills?.length) throw new ProtocolError("invalid_request", "Message is empty");
	if (await host.runtime.conversationIndex().deleted(`bot:${botId}`)) throw new ProtocolError("not_found", "Conversation is unavailable");
	const bot = await host.liveBot(botId);
	if (bot.model === undefined && (await host.runtime.defaultModel()) === undefined) {
		throw new ProtocolError("invalid_request", "Choose a model in Settings before messaging a Bot");
	}
	return host.runs.submit(botId, requestId, text, { ...(artifactIds ? { artifactIds } : {}), ...(skills ? { skills } : {}) });
}

export async function resetConversation(host: ConversationHost, params: HostParams<"conversations.reset">): Promise<null> {
	const { botId } = params;
	await host.runs.cancelMatching((run) => run.botId === botId && (!run.channelId || run.channelId === "direct"));
	await host.background.stopConversation(botId, await host.runtime.conversationKey(botId));
	await host.runtime.reset(botId);
	return null;
}

export async function deleteConversation(host: ConversationHost, params: HostParams<"conversations.delete">) {
	const { conversationKey } = params;
	if (!conversationKey.startsWith("bot:")) throw new ProtocolError("invalid_request", "Only a direct conversation can be deleted");
	const botId = conversationKey.slice(4);
	const bot = await host.liveBot(botId);
	if (bot.kind === "core") throw new ProtocolError("invalid_request", "The Core conversation cannot be deleted");
	// Seal the index before cleanup. A submit during cancel, stop, or forget already sees this
	// conversation as deleted, and a cleanup failure stays deleted so a retry can finish it.
	await host.runtime.conversationIndex().deleteConversation(conversationKey);
	try {
		const conversationId = await host.runtime.conversationKey(botId);
		await host.runs.cancelMatching((run) => run.botId === botId && (!run.channelId || run.channelId === "direct"));
		await host.background.stopConversation(botId, conversationId);
		await host.approvals.forgetConversation(conversationId);
		return { conversationId };
	} finally {
		host.emit({ type: "bots.changed", payload: {} });
	}
}

export async function reopenConversation(host: ConversationHost, params: HostParams<"conversations.reopen">): Promise<null> {
	const { botId } = params;
	const bot = await host.liveBot(botId);
	if (bot.kind === "core") throw new ProtocolError("invalid_request", "The Core conversation cannot be deleted");
	const conversationId = await host.runtime.conversationKey(botId);
	await host.runs.cancelMatching((run) => run.botId === botId && (!run.channelId || run.channelId === "direct"));
	await host.background.stopConversation(botId, conversationId);
	await host.runtime.reopenDirect(botId);
	host.emit({ type: "bots.changed", payload: {} });
	return null;
}

export async function subscribeConversation(host: ConversationHost, params: HostParams<"conversations.subscribe">): Promise<null> {
	if (params.botId !== null) await host.liveBot(params.botId);
	host.feed.subscribe(params.botId);
	return null;
}

export async function directSnapshot(host: ConversationHost, params: HostParams<"conversations.snapshot">): Promise<ConversationSnapshot> {
	return projectConversation(host, await host.runtime.snapshot(params.botId, "direct", params.history));
}

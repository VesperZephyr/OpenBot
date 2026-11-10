import { randomUUID } from "node:crypto";
import type { BotRuntime } from "@openbot/agent-runtime";
import {
	legacyManagementName,
	ProtocolError,
	type ArtifactOperation,
	type ArtifactOperationResult,
	type AvatarImage,
	type BotId,
	type BotProfile,
	type BotSummary,
	type HostParams,
} from "@openbot/protocol";
import type { ApprovalBook } from "./approvals.ts";
import type { BotManagement, ManagementCall } from "./bot-management.ts";
import type { ConversationFeed } from "./conversation-feed.ts";
import type { EventSink } from "./host-ports.ts";
import type { ObserverState } from "./host-conversations.ts";
import type { RunScheduler } from "./runs.ts";
import type { Skills } from "./skills.ts";

export type BotHost = {
	readonly runtime: BotRuntime;
	now(): number;
	emit: EventSink;
	readonly skills: Skills;
	artifact(requestId: string, operation: ArtifactOperation): Promise<ArtifactOperationResult>;
	liveBot(botId: BotId): Promise<BotProfile>;
	observe(botId: BotId): Promise<void>;
	readonly runs: RunScheduler;
	readonly approvals: ApprovalBook;
	readonly observers: Map<BotId, ObserverState>;
	readonly feed: ConversationFeed;
	conversationStopped(botId: BotId, channelId?: string, runId?: string): void;
	readonly management: BotManagement;
	serialize<T>(work: () => Promise<T>): Promise<T>;
};

export async function liveHostBot(runtime: BotRuntime, botId: BotId): Promise<BotProfile> {
	const bot = await runtime.getBot(botId);
	if (bot === undefined || bot.status === "deleted") throw new ProtocolError("not_found", `Unknown Bot: ${botId}`);
	return bot;
}

export async function stopHostBot(host: BotHost, botId: BotId): Promise<void> {
	await host.runs.cancelMatching((run) => run.botId === botId);
	host.conversationStopped(botId);
	for (const channel of await host.runtime.channels()) if (channel.botId === botId) host.conversationStopped(botId, channel.channelId);
}

export async function listHostBots(host: BotHost): Promise<BotSummary[]> {
	const bots = await host.runtime.listBots();
	const index = new Map((await host.runtime.conversationIndex().list()).map((row) => [row.conversationKey, row]));
	return bots
		.filter((bot) => bot.status !== "deleted")
		.map((bot) => {
			const lastRun = host.runs.latest(bot.botId);
			const directActivity = host.observers.get(bot.botId)?.activity ?? "idle";
			const taskActivity = host.runs.taskActivity(bot.botId);
			const activity = taskActivity === "working" || directActivity === "working" ? "working" : taskActivity ?? directActivity;
			return {
				...bot,
				activity: activity === "idle" && (index.get(`bot:${bot.botId}`)?.unreadCount ?? 0) > 0 ? ("unread" as const) : activity,
				pendingApprovals: host.approvals.forBot(bot.botId).length,
				...(lastRun === undefined
					? {}
					: {
							lastRun: { runId: lastRun.runId, state: lastRun.state, ...(lastRun.error === undefined ? {} : { error: lastRun.error }) },
						}),
			};
		});
}

export async function createHostBot(host: BotHost, params: HostParams<"bots.create">): Promise<BotProfile> {
	const profile = await host.runtime.createBot({
		botId: `bot_${params.requestId}`,
		name: params.name,
		...(params.role === undefined ? {} : { role: params.role }),
		...(params.instructions === undefined ? {} : { instructions: params.instructions }),
		...(params.model === undefined ? {} : { model: params.model }),
		createdAt: host.now(),
	});
	await host.observe(profile.botId);
	host.emit({ type: "bots.changed", payload: {} });
	return profile;
}

export async function updateHostBot(host: BotHost, params: HostParams<"bots.update">): Promise<BotProfile> {
	const { botId, avatar, ...change } = params;
	await host.liveBot(botId);
	if (change.defaultSkills !== undefined) {
		if (change.expectedRevision === undefined) throw new ProtocolError("invalid_request", "Reload the profile before changing role skills");
		await host.skills.attachments(change.defaultSkills);
	}
	if (change.name !== undefined && !change.name.trim()) throw new ProtocolError("invalid_request", "Give this Bot a name.");
	if (avatar && change.expectedRevision === undefined) throw new ProtocolError("invalid_request", "Reload the profile before changing its avatar.");
	const image = avatar?.kind === "upload" ? await host.artifact(randomUUID(), { action: "avatar-validate", base64: avatar.base64 }) as AvatarImage : undefined;
	const resolved = image ? { kind: "image" as const, sha256: image.sha256 } : avatar?.kind === "generated" ? avatar : undefined;
	const profile = await host.runtime.updateBot(botId, { ...change, ...(resolved ? { avatar: resolved } : {}) }, undefined, image);
	host.emit({ type: "bots.changed", payload: {} });
	return profile;
}

export async function duplicateHostBot(host: BotHost, params: HostParams<"bots.duplicate">): Promise<BotProfile> {
	const source = await host.liveBot(params.botId);
	const profile = await host.runtime.createBot({
		botId: `bot_${params.requestId}`,
		name: `${source.name} (copy)`,
		role: source.role,
		instructions: source.instructions,
		...(source.avatar ? { avatar: source.avatar } : {}),
		...(source.defaultSkills ? { defaultSkills: source.defaultSkills } : {}),
		...(source.model === undefined ? {} : { model: source.model }),
		...(source.thinkingLevel === undefined ? {} : { thinkingLevel: source.thinkingLevel }),
		createdAt: host.now(),
	});
	await host.observe(profile.botId);
	host.emit({ type: "bots.changed", payload: {} });
	return profile;
}

function forgetObservedBot(host: BotHost, botId: BotId): void {
	host.observers.get(botId)?.stop();
	host.observers.delete(botId);
	if (host.feed.subscribed === botId) host.feed.subscribe(null);
}

export async function deleteHostBot(host: BotHost, params: HostParams<"bots.delete">): Promise<null> {
	const bot = await host.runtime.getBot(params.botId);
	if (bot === undefined) throw new ProtocolError("not_found", `Unknown Bot: ${params.botId}`);
	if (bot.kind === "core") throw new ProtocolError("invalid_request", "The Core Bot cannot be deleted");
	if (bot.status === "deleted") return null;
	// Stop its work first, so no Run keeps going for a Bot the user can no longer see. Background commands
	// outlive the Run that started them, so they are stopped whether or not a Run is active.
	await stopHostBot(host, params.botId);
	await host.runtime.updateBot(params.botId, { status: "deleted" });
	forgetObservedBot(host, params.botId);
	host.emit({ type: "bots.changed", payload: {} });
	return null;
}

export function manageHostBots(host: BotHost, call: ManagementCall): Promise<{ status: "succeeded" | "failed"; output: string }> {
	return host.serialize(async () => {
		try {
			if (legacyManagementName(call.tool) === "bot_inspect") {
				const decision = await host.management.prepare(call);
				if (decision.kind === "deny") throw new ProtocolError("invalid_request", decision.reason);
				const bots = (await host.runtime.listBots()).filter(
					(b) => b.status !== "deleted" && (call.args.botId == null || call.args.botId === b.botId),
				);
				const identities = bots.map(({ avatar: _avatar, ...profile }) => profile);
				const profiles = call.args.botId == null ? identities.map(({ instructions: _instructions, ...summary }) => summary) : identities;
				return { status: "succeeded" as const, output: JSON.stringify(profiles) };
			}
			const proposal = await host.management.confirmed(call);
			const saved = await host.runtime.management().get(proposal.invocationId);
			let result = saved?.result;
			if (!result) {
				if (proposal.action === "delete") {
					await stopHostBot(host, proposal.botId);
				}
				call.signal.throwIfAborted();
				await host.management.confirmed(call);
				if (proposal.action === "create") {
					const { model, ...fields } = proposal.change;
					result = await host.runtime.createBot(
						{ ...fields, name: proposal.change.name!, botId: proposal.botId, createdAt: proposal.createdAt, ...(model ? { model } : {}) },
						proposal,
					);
				} else
					result = await host.runtime.updateBot(
						proposal.botId,
						proposal.action === "delete" ? { status: "deleted" } : proposal.change,
						proposal,
					);
			}
			if (result.status === "deleted") forgetObservedBot(host, result.botId);
			else await host.observe(result.botId);
			host.emit({ type: "bots.changed", payload: {} });
			const { avatar: _avatar, ...profile } = result;
			return { status: "succeeded" as const, output: JSON.stringify({ action: proposal.action, bot: profile }) };
		} catch (error) {
			if (call.signal.aborted) throw error;
			return {
				status: "failed" as const,
				output: error instanceof ProtocolError ? error.message : "Bot management failed. Inspect the current state before trying again.",
			};
		}
	});
}

import { createHash } from "node:crypto";
import { defineDocFamily, type Harness } from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord/context";
import { ProtocolError } from "@openbot/protocol";
import { PolicyDoc } from "./policy.ts";
import { BotsDoc } from "./bots.ts";
import { RunsDoc } from "./runs.ts";
import { GroupsDoc } from "./groups.ts";
import { BackgroundDoc } from "./background.ts";
import { MessageModeDoc, runConversation } from "./message-records.ts";
import { groupProjection, projectConversation } from "./conversation-index.ts";

export type MessageCall = {
	botId: string;
	conversationId: string;
	runId: string;
	callId: string;
	targetId: string;
	text: string;
	authorityRevision?: number;
};
export type MessageReceipt = { messageId: string; publishedAt: number };
const Receipts = defineDocFamily<{ digest?: string; receipt?: MessageReceipt }, null>({
	kind: "openbot.message-receipt",
	version: 1,
	family: true,
	scope: "session",
	initial: () => ({}),
});
const Quotas = defineDocFamily<{ count: number; bytes: number }, null>({
	kind: "openbot.message-quota",
	version: 1,
	family: true,
	scope: "session",
	initial: () => ({ count: 0, bytes: 0 }),
});
const fingerprint = (call: MessageCall) =>
	createHash("sha256")
		.update(JSON.stringify([call.botId, call.conversationId, call.runId, call.targetId, call.text]))
		.digest("hex");
const fail = (): never => {
	throw new ProtocolError("invalid_request", "Message publication is unavailable for this Run");
};
export function messageStore(harness: Harness, context: Context) {
	return {
		async receipt(call: MessageCall): Promise<MessageReceipt | undefined> {
			const old = await harness.snapshot(Receipts, `${call.conversationId}:${call.callId}`, context);
			if (old?.digest && old.digest !== fingerprint(call)) throw new ProtocolError("request_conflict", "Message invocation changed");
			return old?.receipt;
		},
		async publish(call: MessageCall, assertAllowed: () => void): Promise<MessageReceipt> {
			return harness.commit(async (tx) => {
				const receipt = await tx.doc(Receipts, `${call.conversationId}:${call.callId}`, null),
					digest = fingerprint(call);
				if (receipt.digest && receipt.digest !== digest) throw new ProtocolError("request_conflict", "Message invocation changed");
				if (receipt.receipt) return { ...receipt.receipt };
				const runs = (await tx.doc(RunsDoc)).runs;
				const policy = await tx.doc(PolicyDoc);
				if (
					(policy.targetId && policy.targetId !== call.targetId) ||
					(call.authorityRevision !== undefined && call.authorityRevision !== (policy.revision ?? 0))
				)
					fail();
				const run = runs[call.runId],
					bot = (await tx.doc(BotsDoc)).bots[call.botId];
				if (
					!run ||
					run.state !== "running" ||
					run.interruption ||
					run.botId !== call.botId ||
					run.origin === "routine" ||
					!bot ||
					bot.status !== "active"
				)
					fail();
				const conversation = await runConversation(tx, run!);
				if (
					!conversation ||
					String(conversation) !== call.conversationId ||
					!(await tx.doc(MessageModeDoc, call.conversationId, null)).entryId
				)
					fail();
				const background =
					run!.origin === "background"
						? Object.values((await tx.doc(BackgroundDoc)).records).find((r) =>
								run!.requestIds.includes(r.deliveryId ? `delivery:${r.deliveryId}` : `completion:${r.invocationId}`),
							)
						: undefined;
				if (
					run!.origin === "background" &&
					(!background ||
						!["ready", "queued", "delivering"].includes(background.state) ||
						background.targetId !== call.targetId ||
						(background.continuationRunId !== undefined && background.continuationRunId !== run!.runId))
				)
					fail();
				if (background) {
					const source = runs[background.sourceRunId];
					if (
						!source ||
						source.state !== "completed" ||
						source.interruption ||
						source.botId !== call.botId ||
						background.conversationId !== call.conversationId
					)
						fail();
				}
				const groups = run!.channelId && run!.channelId !== "direct" ? await tx.doc(GroupsDoc) : undefined;
				const delivery = groups && Object.values(groups.deliveries).find((d) => run!.requestIds.includes(`delivery:${d.deliveryId}`));
				const group = groups && groups.groups[run!.channelId!],
					root = delivery?.rootId ? groups?.roots?.[delivery.rootId] : undefined;
				if (
					groups &&
					(!group ||
						group.status !== "active" ||
						!delivery ||
						delivery.state !== "pending" ||
						delivery.closed ||
						delivery.transferId ||
						(root && root.state !== "running") ||
						(!group.memberIds.includes(call.botId) && root?.coreBotId !== call.botId))
				)
					fail();
				if (background?.deliveryId && groups) {
					const source = delivery?.backgroundSourceId ? groups.deliveries[delivery.backgroundSourceId] : undefined;
					if (!source || source.transferId || ["failed", "cancelled"].includes(source.state)) fail();
				}
				const bytes = Buffer.byteLength(call.text),
					quota = await tx.doc(Quotas, call.runId, null);
				if (!call.text.trim() || bytes > 16384) throw new ProtocolError("invalid_request", "Message must contain 1–16384 UTF-8 bytes");
				if (quota.count >= 16 || quota.bytes + bytes > 131072)
					throw new ProtocolError("invalid_request", "Update quota reached; continue with a final answer");
				assertAllowed();
				const publishedAt = Date.now(),
					provenance = {
						runId: call.runId,
						botId: call.botId,
						conversationId: call.conversationId,
						callId: call.callId,
						targetId: call.targetId,
					};
				let messageId: string;
				if (groups && group && delivery) {
					messageId = `update:${call.conversationId}:${call.callId}`;
					(groups.posts[group.groupId] ??= []).push({
						postId: messageId,
						kind: "update",
						senderId: call.botId,
						recipientIds: [],
						text: call.text,
						at: publishedAt,
						replyTo: delivery.postId,
						...(delivery.rootId ? { rootId: delivery.rootId } : {}),
						update: { ...provenance, deliveryId: delivery.deliveryId },
					});
					await projectConversation(tx, `group:${group.groupId}`, groupProjection(groups.posts[group.groupId]!));
				} else {
					const entry = await tx.appendEntry(conversation!, {
						kind: "openbot.bot-message",
						data: { version: 1, text: call.text, at: publishedAt, ...provenance },
					});
					messageId = String(entry.id);
				}
				quota.count++;
				quota.bytes += bytes;
				receipt.digest = digest;
				receipt.receipt = { messageId, publishedAt };
				return { ...receipt.receipt };
			}, context);
		},
	};
}

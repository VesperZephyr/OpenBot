import type { Context } from "@earendil-works/chord/context";
import { UsageDoc, type Harness, type ConversationId } from "@earendil-works/pi-durable";
import { ProtocolError, type BotUsage, type UsageBucket } from "@openbot/protocol";
import { UsageEvidenceDoc, usageSummary, zero, addCounters, sameCounters, entryBounds } from "./usage.ts";
import { RunsDoc } from "./runs.ts";
import { BotsDoc } from "./bots.ts";
import { GroupsDoc } from "./groups.ts";
import { AppExecutionsDoc } from "./app-executions.ts";
import { ApprovalsDoc } from "./approvals.ts";

/** Content-free projection in one transaction; all Pi shapes stay inside the adapter. */
export function readUsage(
	harness: Harness,
	context: Context,
	botId: string,
	ids: readonly number[],
	limit: number,
	epoch: string,
): Promise<BotUsage> {
	return harness.commit(async (tx) => {
		const live = (await tx.doc(BotsDoc)).bots[botId];
		if (!live || live.status === "deleted") throw new ProtocolError("not_found", "Bot is unavailable");
		const evidence = await tx.doc(UsageEvidenceDoc);
		const runs = Object.values((await tx.doc(RunsDoc)).runs)
			.filter((r) => r.botId === botId)
			.sort((a, b) => b.createdAt - a.createdAt)
			.slice(0, limit);
		let totalCounters = zero();
		const combined = new Map<string, UsageBucket>();
		for (const id of ids) {
			const models = (await tx.doc(UsageDoc, id as ConversationId)).models;
			for (const [key, value] of Object.entries(models)) {
				const row = usageSummary({ [key]: value }).models[0];
				if (!row) continue;
				totalCounters = addCounters(totalCounters, row);
				combined.set(key, { ...addCounters(combined.get(key) ?? zero(), row), modelKey: key, source: "unknown" });
			}
		}
		const account = evidence.bots[botId];
		const available =
			totalCounters.totalTokens > 0 ||
			totalCounters.input > 0 ||
			totalCounters.output > 0 ||
			totalCounters.cacheRead > 0 ||
			totalCounters.cacheWrite > 0;
		const total: import("@openbot/protocol").UsageSummary = {
			...totalCounters,
			available,
			models: [...combined.values()].slice(0, 100),
			truncated: combined.size > 100,
			...(available && account?.complete && sameCounters(account.counters, totalCounters) ? { estimatedUsd: account.usd } : {}),
		};
		const approvals = (await tx.doc(ApprovalsDoc)).approvals;
		const groups = await tx.doc(GroupsDoc);
		const executions = (await tx.doc(AppExecutionsDoc)).executions;
		const rows: import("@openbot/protocol").RunEvidence[] = [];
		for (const run of runs) {
			const interval = evidence.intervals[run.runId];
			const summary =
				interval?.settled ??
				(interval
					? usageSummary(
							(await tx.doc(UsageDoc, interval.conversationId as ConversationId)).models,
							interval.baseline,
							interval.stamp,
							epoch,
						)
					: usageSummary({}));
			const group = run.channelId && run.channelId !== "direct" ? run.channelId : undefined;
			const refs: import("@openbot/protocol").RunEvidence["references"][number][] = [];
			let more = false;
			if (group) {
				const delivery = Object.values(groups.deliveries).find((d) => d.runId === run.runId && d.botId === botId);
				const post =
					delivery && groups.posts[delivery.groupId]?.find((p) => p.postId === `reply:${delivery.deliveryId}` && p.senderId === botId);
				if (post) refs.push({ kind: "result", messageId: post.postId });
			} else if (interval) {
				const page = await tx.scanEntries({ conversationId: interval.conversationId as ConversationId, ...entryBounds(interval) }, 100);
				more = page.next !== undefined;
				for (const input of run.inputs) {
					const submission = await tx.submissionByRequest(interval.conversationId as ConversationId, input.requestId);
					if (
						submission?.type === "input" &&
						submission.status === "done" &&
						submission.answer > interval.startEntry &&
						(interval.endEntry === undefined || submission.answer <= interval.endEntry)
					)
						refs.push({ kind: "result", messageId: String(submission.answer) });
				}
				for (const entry of page.items)
					for (const message of entry.model ?? [])
						if (message.role === "assistant") {
							for (const call of message.content)
								if (call.type === "toolCall") {
									refs.push({ kind: "tool", messageId: call.id });
									const execution = Object.values(executions).find(
										(e) =>
											e.parentCallId === call.id &&
											e.botId === botId &&
											e.conversationId === String(interval.conversationId) &&
											e.authority.runId === run.runId,
									);
									const callIds = new Set([call.id, ...(execution?.children.map((c) => c.callId) ?? [])]);
									for (const approval of Object.values(approvals))
										if (
											approval.botId === botId &&
											approval.conversationId === String(interval.conversationId) &&
											callIds.has(approval.callId)
										)
											refs.push({ kind: "approval", messageId: call.id, approvalId: approval.approvalId, approvalState: approval.state });
								}
						}
			}
			rows.push({
				runId: run.runId,
				state: run.state,
				createdAt: run.createdAt,
				...(run.endedAt === undefined ? {} : { endedAt: run.endedAt }),
				conversationKey: group ? `group:${group}` : `bot:${botId}`,
				usage: summary,
				references: refs.slice(0, 20),
				referencesTruncated: more || refs.length > 20,
			});
		}
		return JSON.parse(JSON.stringify({ botId, total, runs: rows }));
	}, context);
}

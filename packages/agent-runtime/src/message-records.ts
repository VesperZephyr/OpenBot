import { defineDocFamily, type Tx, type ConversationId } from "@earendil-works/pi-durable";
import type { StoredRun } from "./runs.ts";
import { BotsDoc } from "./bots.ts";
import { ChannelsDoc } from "./channels.ts";

export const MessageModeDoc = defineDocFamily<{ entryId?: number }, null>({
	kind: "openbot.message-mode",
	version: 1,
	scope: "session",
	family: true,
	initial: () => ({}),
});
export const AnswerVisibilityDoc = defineDocFamily<{ outcomeEntryId?: number }, null>({
	kind: "openbot.answer-visibility",
	version: 1,
	scope: "session",
	family: true,
	initial: () => ({}),
});
export const RunOutcomeDoc = defineDocFamily<{ firstEntryId?: number; latestEntryId?: number }, null>({
	kind: "openbot.run-outcome-index",
	version: 1,
	scope: "session",
	family: true,
	initial: () => ({}),
});
export type InputOutcomeData = {
	version: 1;
	runId: string;
	requestId: string;
	submissionId: string;
	origin: string;
	category: "answered" | "failed" | "cancelled" | "withdrawn";
	inputEntryId?: number;
	answerEntryId?: number;
	publishAnswer?: boolean;
};
export type RunOutcomeData = {
	version: 1;
	runId: string;
	botId: string;
	channelId: string;
	origin: string;
	state: StoredRun["state"];
	reason: string;
	requestedAt?: number;
	settledAt?: number;
	endedAt?: number;
	inputs: { requestId: string; submissionId?: string; failed: boolean }[];
};
export function inputCategory(input: StoredRun["inputs"][number]): InputOutcomeData["category"] {
	if (input.outcome?.status === "done") return "answered";
	if (input.outcome?.reason === "withdrawn") return "withdrawn";
	if (input.outcome?.reason === "aborted") return "cancelled";
	return "failed";
}
export async function runConversation(tx: Tx, run: StoredRun): Promise<ConversationId | undefined> {
	const id =
		!run.channelId || run.channelId === "direct"
			? (await tx.doc(BotsDoc)).bots[run.botId]?.conversationId
			: Object.values((await tx.doc(ChannelsDoc)).channels).find((c) => c.botId === run.botId && c.channelId === run.channelId)
					?.conversationId;
	return id as ConversationId | undefined;
}
export async function recordOutcomes(tx: Tx, run: StoredRun, previous?: StoredRun): Promise<void> {
	const conversationId = await runConversation(tx, run);
	if (conversationId === undefined || run.origin === "routine") return;
	const mode = await tx.doc(MessageModeDoc, String(conversationId), null);
	if (!run.messageMode && !mode.entryId) return;
	const pending: { data: InputOutcomeData; visibility?: { outcomeEntryId?: number } }[] = [];
	if (mode.entryId)
		for (const input of run.inputs) {
			if (
				!input.outcome ||
				!input.submissionId ||
				JSON.stringify(previous?.inputs.find((i) => i.requestId === input.requestId)?.outcome) === JSON.stringify(input.outcome)
			)
				continue;
			const submission = await tx.submissionByRequest(conversationId, input.requestId);
			if (!submission || submission.type !== "input") throw Error("Input settlement is unavailable");
			const category = inputCategory(input);
			if (category === "answered" && submission.status !== "done") throw Error("Input answer is not committed");
			const answer = category === "answered" && submission.status === "done" ? submission.answer : undefined;
			const visibility = answer === undefined ? undefined : await tx.doc(AnswerVisibilityDoc, String(answer), null);
			const data: InputOutcomeData = {
				version: 1,
				runId: run.runId,
				requestId: input.requestId,
				submissionId: input.submissionId,
				origin: run.origin ?? "user",
				category,
				...(submission.entry === undefined ? {} : { inputEntryId: submission.entry }),
				...(answer === undefined ? {} : { answerEntryId: answer, publishAnswer: !visibility?.outcomeEntryId }),
			};
			pending.push({ data, ...(visibility ? { visibility } : {}) });
		}
	for (const { data, visibility } of pending) {
		if (visibility) data.publishAnswer = !visibility.outcomeEntryId;
		const entry = await tx.appendEntry(conversationId, { kind: "openbot.input-outcome", data });
		if (visibility && !visibility.outcomeEntryId) visibility.outcomeEntryId = entry.id;
	}
	const abnormal = !!run.interruption || ["failed", "cancelled", "needs_attention"].includes(run.state);
	if (!abnormal && !previous?.interruption) return;
	const describe = (r: StoredRun): RunOutcomeData => ({
		version: 1,
		runId: r.runId,
		botId: r.botId,
		channelId: r.channelId ?? "direct",
		origin: r.origin ?? "user",
		state: r.state,
		reason: r.interruption?.reason ?? (r.state === "cancelled" && !r.inputs.length ? "queued_cancelled" : r.state),
		...(r.interruption
			? {
					requestedAt: r.interruption.requestedAt,
					...(r.interruption.settledAt === undefined ? {} : { settledAt: r.interruption.settledAt }),
				}
			: {}),
		...(r.endedAt === undefined ? {} : { endedAt: r.endedAt }),
		inputs: r.inputs.map((i) => ({
			requestId: i.requestId,
			...(i.submissionId ? { submissionId: i.submissionId } : {}),
			failed: !!i.outcome && inputCategory(i) === "failed",
		})),
	});
	const data = describe(run);
	if (previous && JSON.stringify(data) === JSON.stringify(describe(previous))) return;
	const index = await tx.doc(RunOutcomeDoc, run.runId, null);
	const entry = await tx.appendEntry(conversationId, { kind: "openbot.run-outcome", data });
	index.firstEntryId ??= entry.id;
	index.latestEntryId = entry.id;
}

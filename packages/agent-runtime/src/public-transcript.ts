import type { Harness, EntryRecord, EntryId, ConversationId } from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord/context";
import type { TranscriptItem } from "@openbot/protocol";
import { MessageModeDoc, RunOutcomeDoc, type InputOutcomeData, type RunOutcomeData } from "./message-records.ts";
import { toTranscript, textParts } from "./transcript.ts";

export type PublicSelection = { items: TranscriptItem[]; source: number; remove: string[] };
export class PublicTranscript {
	private harness: Harness;
	private context: Context;
	constructor(harness: Harness, context: Context) {
		this.harness = harness;
		this.context = context;
	}
	async mode(conversationId: number) {
		return (await this.harness.snapshot(MessageModeDoc, String(conversationId), this.context))?.entryId;
	}
	private async entry(id: number, conversationId: number) {
		const c = await this.harness.conversation(conversationId as ConversationId, this.context);
		return (await c?.entries({ minEntryId: id as EntryId, maxEntryId: id as EntryId }, 1, undefined, this.context))?.items[0];
	}
	private async run(runId: string, conversationId: number) {
		const index = await this.harness.snapshot(RunOutcomeDoc, runId, this.context);
		const entry = index?.latestEntryId ? await this.entry(index.latestEntryId, conversationId) : undefined;
		return { first: index?.firstEntryId, data: entry?.data as RunOutcomeData | undefined };
	}
	async select(entry: EntryRecord, mode: number | undefined, seeds: readonly TranscriptItem[] = []): Promise<PublicSelection> {
		const raw = toTranscript([entry], seeds),
			selected: PublicSelection = { items: raw, source: entry.id, remove: [] };
		if (entry.kind === "openbot.bot-message") {
			const data = entry.data as { text: string; at: number };
			selected.items = [{ kind: "assistant", id: String(entry.id), parts: [{ type: "text", text: data.text }], at: data.at }];
		} else if (entry.kind === "openbot.input-outcome") {
			const data = entry.data as InputOutcomeData,
				id = `outcome:${data.submissionId}`,
				run = (await this.run(data.runId, entry.conversationId)).data;
			selected.items = [];
			if (data.category === "answered") {
				if (!data.publishAnswer || !data.answerEntryId) return selected;
				const answer = await this.entry(data.answerEntryId, entry.conversationId);
				if (!answer || answer.conversationId !== entry.conversationId) throw Error("Canonical answer is unavailable");
				selected.source = answer.id;
				const parts = textParts(answer),
					message = answer.model?.[0];
				const artifacts: import("@openbot/protocol").ArtifactRef[] = [];
				if (!parts.some((p) => p.text.trim()) && data.inputEntryId) {
					const conversation = await this.harness.conversation(entry.conversationId, this.context);
					let cursor: Parameters<NonNullable<typeof conversation>["entries"]>[2];
					do {
						const page = await conversation!.entries(
							{ minEntryId: data.inputEntryId as EntryId, maxEntryId: answer.id, order: "ascending" },
							256,
							cursor,
							this.context,
						);
						for (const e of page.items) {
							const result = e.kind === "pi.tool-result" ? e.model?.[0] : undefined;
							const details =
								result?.role === "toolResult" && !result.isError
									? (result.details as { artifact?: import("@openbot/protocol").ArtifactRef; status?: string } | undefined)
									: undefined;
							if (
								details?.status === "succeeded" &&
								details.artifact?.availability === "available" &&
								!artifacts.some((a) => a.artifactId === details.artifact!.artifactId)
							)
								artifacts.push(details.artifact);
						}
						cursor = page.next;
					} while (cursor);
				}
				selected.items =
					parts.some((p) => p.text.trim()) || artifacts.length
						? [
								{
									kind: "assistant",
									id: String(answer.id),
									parts,
									...(artifacts.length ? { artifacts } : {}),
									...(message?.role === "assistant" ? { at: message.timestamp } : {}),
								},
							]
						: [{ kind: "outcome", id, runId: data.runId, category: "empty" }];
			} else if (
				data.category !== "withdrawn" &&
				!(run?.requestedAt !== undefined || run?.state === "cancelled" || run?.state === "needs_attention")
			) {
				selected.items = [{ kind: "outcome", id, runId: data.runId, category: data.category }];
			}
		} else if (entry.kind === "openbot.run-outcome") {
			const event = entry.data as RunOutcomeData,
				latest = await this.run(event.runId, entry.conversationId),
				data = latest.data ?? event;
			selected.source = latest.first ?? entry.id;
			const id = `run-outcome:${data.runId}`;
			selected.items = [];
			if (data.state === "completed" || (data.state === "failed" && data.inputs.some((i) => i.failed) && data.requestedAt === undefined))
				selected.remove.push(id);
			else {
				const category =
					data.requestedAt !== undefined && data.settledAt === undefined
						? "stopping"
						: data.state === "needs_attention"
							? "interrupted"
							: data.reason === "queued_cancelled"
								? "queued_cancelled"
								: data.state === "failed"
									? "failed"
									: "cancelled";
				selected.items = [
					{ kind: "outcome", id, runId: data.runId, category, ...(data.endedAt === undefined ? {} : { at: data.endedAt }) },
				];
				if (category !== "failed")
					selected.remove.push(...data.inputs.flatMap((i) => (i.submissionId ? [`outcome:${i.submissionId}`] : [])));
			}
		} else if (entry.kind === "openbot.messages-v1") selected.items = [];
		else if (mode !== undefined && entry.id > mode) {
			selected.items = raw.filter((item) => (entry.kind !== "pi.assistant" || item.kind !== "assistant") && item.kind !== "stopped");
			for (const item of selected.items)
				if (item.kind === "tool" && item.tool === "send_message" && item.status === "succeeded") selected.remove.push(item.id);
			selected.items = selected.items.filter((item) => !selected.remove.includes(item.id));
		}
		return selected;
	}
}

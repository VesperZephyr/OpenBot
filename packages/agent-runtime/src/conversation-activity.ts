/** Small execution/attention projection. It remains available when the disposable history worker fails. */
import { setImmediate as yieldTurn } from "node:timers/promises";
import type { Harness, ConversationId, EntryId } from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord/context";
import type { ArtifactRef, ConversationPreview, ToolCallStatus } from "@openbot/protocol";
import { AppExecutionsDoc } from "./app-executions.ts";
import { directMessages, previewText, projectConversation } from "./conversation-index.ts";
import { toTranscript } from "./transcript.ts";
export type CommittedToolOutcome = { id: string; tool: string; status: ToolCallStatus; conversationId: string };
export class ConversationActivity {
	readonly outcomes = new Set<(outcome: CommittedToolOutcome) => void>();
	readonly changes = new Set<() => void>();
	attention = false;
	unknown = false;
	incoming = 0;
	count = 0;
	latest: ConversationPreview | undefined;
	readonly artifacts: ArtifactRef[] = [];
	#last = 0;
	#dirty = true;
	#executions = true;
	#closed = false;
	#line: Promise<void> | undefined;
	#stop: () => void;
	#children = new Set<string>();
	private harness: Harness;
	private context: Context;
	private botId: string;
	private conversationId: number;
	private direct: boolean;
	constructor(harness: Harness, context: Context, botId: string, conversationId: number, direct: boolean) {
		this.harness = harness;
		this.context = context;
		this.botId = botId;
		this.conversationId = conversationId;
		this.direct = direct;
		this.#stop = harness.subscribeCommits((publication) => {
			for (const change of publication.changes) {
				if (change.type === "entry" && change.value.conversationId === conversationId) this.#dirty = true;
				if (change.type === "document" && change.record.kind === AppExecutionsDoc.definition.kind) this.#executions = true;
			}
			if (this.#dirty || this.#executions) this.schedule();
		});
		this.schedule();
	}
	private schedule() {
		if (this.#line || this.#closed) return;
		this.#line = this.scan().finally(() => {
			this.#line = undefined;
			if (!this.#closed && (this.#dirty || this.#executions)) this.schedule();
		});
		void this.#line.catch(() => {});
	}
	private emit(outcome: Omit<CommittedToolOutcome, "conversationId">) {
		for (const listener of this.outcomes) listener({ ...outcome, conversationId: String(this.conversationId) });
	}
	private async scan() {
		await yieldTurn();
		const conversation = await this.harness.conversation(this.conversationId as ConversationId, this.context);
		if (!conversation) return;
		while (!this.#closed && (this.#dirty || this.#executions)) {
			if (this.#dirty) {
				this.#dirty = false;
				let more = true;
				while (more && !this.#closed) {
					const page = await conversation.entries(
						{ minEntryId: (this.#last + 1) as EntryId, order: "ascending" },
						256,
						undefined,
						this.context,
					);
					for (const entry of page.items) {
						const result = entry.kind === "pi.tool-result" ? entry.model?.[0] : undefined;
						if (result?.role === "toolResult") {
							const item = toTranscript(
								[entry],
								[{ kind: "tool", id: result.toolCallId, tool: result.toolName, args: {}, status: "pending" }],
							)[0];
							if (item?.kind === "tool") {
								if (item.status === "interrupted") {
									this.attention = true;
									this.unknown = true;
								}
								if (
									item.status === "succeeded" &&
									item.artifact &&
									this.artifacts.length < 20 &&
									!this.artifacts.some((a) => a.artifactId === item.artifact!.artifactId)
								)
									this.artifacts.push(item.artifact);
								this.emit({ id: item.id, tool: item.tool, status: item.status });
							}
						} else {
							const items = toTranscript([entry]);
							if (items.some((item) => item.kind === "user")) this.attention = false;
							for (const message of directMessages({ botId: this.botId, items, approvals: [] })) {
								this.count++;
								if (message.senderId !== "user") this.incoming++;
								this.latest = { ...message, text: previewText(message.text) };
							}
						}
						this.#last = entry.id;
					}
					more = page.next !== undefined;
					await yieldTurn();
				}
				if (this.direct && !this.#closed)
					await this.harness.commit(
						(tx) =>
							projectConversation(tx, `bot:${this.botId}`, {
								messageCount: this.count,
								incomingCount: this.incoming,
								...(this.latest ? { latest: this.latest } : {}),
							}),
						this.context,
					);
			}
			if (this.#executions) {
				this.#executions = false;
				const executions = (await this.harness.snapshot(AppExecutionsDoc, this.context))?.executions ?? {};
				for (const execution of Object.values(executions))
					if (execution.conversationId === String(this.conversationId))
						for (const child of execution.children)
							if (child.state !== "running" && !this.#children.has(child.callId)) {
								this.#children.add(child.callId);
								this.emit({ id: child.callId, tool: child.capability, status: child.state });
							}
			}
			for (const listener of this.changes) listener();
		}
	}
	async evidence() {
		this.schedule();
		await this.#line;
		return { unknown: this.unknown, artifacts: [...this.artifacts] };
	}
	async close() {
		this.#closed = true;
		this.#stop();
		await this.#line?.catch(() => {});
		this.changes.clear();
		this.outcomes.clear();
	}
}

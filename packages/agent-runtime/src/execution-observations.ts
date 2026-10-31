import { randomUUID } from "node:crypto";
import { LiveDoc, type HookApi, type GenerationHooks } from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord/context";
import type { ExecutionObservation, ActivityLabel } from "@openbot/protocol";
import { BotsDoc } from "./bots.ts";
import { ChannelsDoc } from "./channels.ts";
import { RunsDoc } from "./runs.ts";

export class ExecutionObservations {
	readonly changes = new Set<(conversationId: string) => void>();
	readonly current = new Map<string, ExecutionObservation>();
	readonly identities = new Map<string, string>();
	set(value: Omit<ExecutionObservation, "executionKey">, identity?: string) {
		if (identity && this.identities.get(value.runId) === identity) return;
		if (identity) this.identities.set(value.runId, identity);
		else this.identities.delete(value.runId);
		this.current.set(value.runId, { ...value, executionKey: randomUUID() });
		for (const listener of this.changes) listener(value.conversationId);
	}
	clear(runId: string) {
		const old = this.current.get(runId);
		if (!old) return;
		this.current.delete(runId);
		this.identities.delete(runId);
		for (const listener of this.changes) listener(old.conversationId);
	}
	async request(api: HookApi, context: Context) {
		const live = await api.snapshot(LiveDoc, api.conversationId, context);
		const input = live?.run?.inputs.at(-1);
		const botId =
			Object.values((await api.snapshot(BotsDoc, context))?.bots ?? {}).find((b) => b.conversationId === Number(api.conversationId))
				?.botId ??
			Object.values((await api.snapshot(ChannelsDoc, context))?.channels ?? {}).find((c) => c.conversationId === Number(api.conversationId))
				?.botId;
		const run = Object.values((await api.snapshot(RunsDoc, context))?.runs ?? {}).find((r) => r.state === "running" && r.botId === botId);
		if (!run) return;
		this.set({
			runId: run.runId,
			conversationId: String(api.conversationId),
			phase: "generating",
			...(input === undefined ? {} : { consumedInputId: String(input) }),
		});
	}
	hooks(): Partial<GenerationHooks> {
		return {
			beforeRequest: async (_request, api, context) => {
				await this.request(api, context);
			},
		};
	}
	dispatch(
		call: { runId?: string; conversationId: string; callId: string; tool: string; args: Readonly<Record<string, unknown>> },
		phase: "preparing" | "dispatching" | "settled",
	) {
		if (!call.runId) return;
		const old = this.current.get(call.runId);
		if (phase === "settled" && !this.identities.get(call.runId)?.startsWith(JSON.stringify(call.callId) + ":")) return;
		const family: ActivityLabel =
			call.tool === "send_message"
				? "sending_update"
				: ["local_read", "local_list"].includes(call.tool)
					? "reading_files"
					: ["local_write", "local_edit"].includes(call.tool)
						? "writing_files"
						: call.tool === "web_search"
							? "searching_web"
							: call.tool === "web_fetch"
								? "reading_web"
								: call.tool.startsWith("mcp__")
									? "using_connector"
									: call.tool.startsWith("app_")
										? "working_application"
										: "waiting_result";
		this.set(
			{
				runId: call.runId,
				conversationId: call.conversationId,
				phase,
				family,
				...(typeof call.args.taskId === "string" ? { taskId: call.args.taskId } : {}),
				...(old?.consumedInputId ? { consumedInputId: old.consumedInputId } : {}),
			},
			JSON.stringify(call.callId) + ":" + JSON.stringify([phase, call.args.taskId, old?.consumedInputId]),
		);
	}
}

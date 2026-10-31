import { ProtocolError, type ToolOutcome } from "@openbot/protocol";
import type { BotRuntime, MessageCall } from "@openbot/agent-runtime";
import type { ExecutionTarget } from "@openbot/protocol";

export type ToolCall = {
	botId: string;
	conversationId: string;
	callId: string;
	runId?: string;
	target?: ExecutionTarget;
	appExecutionId?: string;
	tool: string;
	dispatchRevision?: number;
	args: Readonly<Record<string, unknown>>;
	signal: AbortSignal;
};

export class BotMessages {
	private options: {
		runtime: BotRuntime;
		targetId: string;
		assertAllowed: () => void;
		assertContext: (call: ToolCall) => Promise<void>;
	};
	constructor(options: BotMessages["options"]) {
		this.options = options;
	}
	private bind(call: ToolCall): MessageCall {
		if (
			call.appExecutionId ||
			!call.runId ||
			call.target?.kind !== "local" ||
			call.target.targetId !== this.options.targetId ||
			Object.keys(call.args).join() !== "text" ||
			typeof call.args.text !== "string" ||
			!call.args.text.trim() ||
			Buffer.byteLength(call.args.text) > 16384
		)
			throw new ProtocolError("invalid_request", "Invalid conversation message");
		return {
			botId: call.botId,
			conversationId: call.conversationId,
			callId: call.callId,
			runId: call.runId,
			targetId: this.options.targetId,
			text: call.args.text,
			...(call.dispatchRevision === undefined ? {} : { authorityRevision: call.dispatchRevision }),
		};
	}
	async replay(call: ToolCall): Promise<ToolOutcome | undefined> {
		const receipt = await this.options.runtime.messages().receipt(this.bind(call));
		return receipt ? { status: "succeeded", output: JSON.stringify(receipt) } : undefined;
	}
	async assertExecution(call: ToolCall): Promise<void> {
		this.bind(call);
		const run = await this.options.runtime.runsStore().get(call.runId!);
		if (
			!run ||
			run.state !== "running" ||
			run.interruption ||
			run.origin === "routine" ||
			run.botId !== call.botId ||
			!run.messageMode ||
			(await this.options.runtime.conversationKey(run.botId, run.channelId)) !== call.conversationId
		)
			throw new ProtocolError("invalid_request", "Message publication is unavailable for this Run");
		await this.options.assertContext(call);
		this.options.assertAllowed();
	}
	async send(call: ToolCall): Promise<ToolOutcome> {
		const old = await this.replay(call);
		if (old) return old;
		await this.assertExecution(call);
		const receipt = await this.options.runtime.messages().publish(this.bind(call), () => {
			call.signal.throwIfAborted();
			this.options.assertAllowed();
		});
		return { status: "succeeded", output: JSON.stringify(receipt) };
	}
}

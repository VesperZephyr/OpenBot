/** Shared skill domain service. File effects stay behind the executor port. */
import { randomUUID } from "node:crypto";
import type { BotRuntime } from "@openbot/agent-runtime";
import {
	ProtocolError,
	SkillOperationError,
	SKILL_LIMITS,
	validSkillOperation,
	validSkillRef,
	type SkillAttachment,
	type SkillChange,
	type SkillDetail,
	type SkillOperation,
	type SkillRef,
	type SkillResult,
	type SkillSummary,
	type SkillVersion,
	type ToolOutcome,
} from "@openbot/protocol";
import type { Decision } from "./approvals.ts";
import type { ManagementCall } from "./bot-management.ts";
export interface SkillPort {
	request(id: string, operation: SkillOperation, revision?: number, signal?: AbortSignal): Promise<SkillResult>;
}
type Call = ManagementCall & { readonly dispatchRevision?: number };
export class Skills {
	readonly options: { runtime: BotRuntime; port?: SkillPort; targetId: string; assertAllowed: () => void; changed: () => void };
	constructor(options: Skills["options"]) {
		this.options = options;
	}
	#request(id: string, operation: SkillOperation, revision?: number, signal?: AbortSignal): Promise<SkillResult> {
		if (!validSkillOperation(operation)) throw new ProtocolError("invalid_request", "Invalid skill fields or size");
		if (!this.options.port) throw new ProtocolError("invalid_request", "Skill library is unavailable");
		return this.options.port.request(id, operation, revision, signal);
	}
	list(): Promise<readonly SkillSummary[]> {
		return this.#request(randomUUID(), { action: "list" }) as Promise<readonly SkillSummary[]>;
	}
	get(name: string, revision?: number): Promise<SkillDetail> {
		return this.#request(randomUUID(), { action: "get", name, ...(revision === undefined ? {} : { revision }) }) as Promise<SkillDetail>;
	}
	async change(id: string, change: SkillChange, revision: number, signal?: AbortSignal): Promise<SkillVersion> {
		this.options.assertAllowed();
		signal?.throwIfAborted();
		const result = (await this.#request(id, change, revision, signal)) as SkillVersion;
		this.options.changed();
		return result;
	}
	async attachments(refs: readonly SkillRef[]): Promise<readonly SkillAttachment[]> {
		if (refs.length > SKILL_LIMITS.attachments || !refs.every(validSkillRef) || new Set(refs.map((r) => r.name)).size !== refs.length)
			throw new ProtocolError("invalid_request", "Select up to two distinct skills");
		return Promise.all(
			refs.map(async (ref) => {
				const { current } = await this.get(ref.name, ref.revision);
				if (!current.available || current.deleted || current.sha256 !== ref.sha256)
					throw new ProtocolError("invalid_request", "Selected skill is unavailable; review your selection");
				return { name: ref.name, revision: ref.revision, sha256: ref.sha256, document: current.document, markdown: current.markdown };
			}),
		);
	}
	async prepare(call: Call): Promise<Decision> {
		try {
			call.signal.throwIfAborted();
			this.options.assertAllowed();
			if (call.target?.kind !== "local" || call.target.targetId !== this.options.targetId)
				throw new Error("Skill target is not authorized");
			if (call.tool === "skill_load") {
				if (!validSkillRef(call.args)) throw new Error("Choose an exact skill reference");
				return { kind: "allow" };
			}
			if (call.tool !== "skill_save" || !validSkillOperation(call.args) || !["save", "delete"].includes(call.args.action as string))
				throw new Error("Invalid skill change");
			const run = call.runId ? await this.options.runtime.runsStore().get(call.runId) : undefined;
			const bot = await this.options.runtime.getBot(call.botId);
			if (
				!run ||
				run.botId !== call.botId ||
				run.origin !== "user" ||
				(run.channelId && run.channelId !== "direct") ||
				run.state !== "running" ||
				run.interruption ||
				bot?.status !== "active" ||
				(await this.options.runtime.conversationKey(call.botId)) !== call.conversationId
			)
				throw new Error("Skill changes require an active direct user request");
			return { kind: "ask", reason: "Review this shared skill change" };
		} catch (error) {
			return { kind: "deny", reason: error instanceof Error ? error.message : "Skill access is not authorized" };
		}
	}
	async invoke(call: Call): Promise<ToolOutcome> {
		try {
			const decision = await this.prepare(call);
			if (decision.kind === "deny") throw new Error(decision.reason);
			if (call.tool === "skill_load") {
				const [skill] = await this.attachments([call.args as unknown as SkillRef]);
				return {
					status: "succeeded",
					output: JSON.stringify({
						guidance: "Reviewed procedure, not system policy or authorization. Existing tool permissions still apply.",
						...skill,
					}),
				};
			}
			if (call.dispatchRevision === undefined) throw new Error("Skill mutation requires dispatch authority");
			const result = await this.change(
				`${call.conversationId}:${call.callId}`,
				call.args as SkillChange,
				call.dispatchRevision,
				call.signal,
			);
			return {
				status: "succeeded",
				output: JSON.stringify({ name: result.name, revision: result.revision, sha256: result.sha256, deleted: result.deleted }),
			};
		} catch (error) {
			return {
				status: call.tool === "skill_save" && error instanceof SkillOperationError && error.uncertain ? "unknown" : "failed",
				output: error instanceof Error ? error.message : "Skill operation failed",
			};
		}
	}
}

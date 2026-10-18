/** Core management authorization and durable bounded proposals. Never infer authority from model text. */
import { createHash } from "node:crypto";
import type { BotRuntime } from "@openbot/agent-runtime";
import {
	type BotManagementActivity,
	type BotManagementChange,
	type BotManagementProposal,
	type ManagementAuthority,
	type ModelRef,
	ProtocolError,
} from "@openbot/protocol";
import type { Decision } from "./approvals.ts";

export type ManagementCall = {
	readonly runId?: string;
	readonly botId: string;
	readonly conversationId: string;
	readonly callId: string;
	readonly tool: string;
	readonly args: Readonly<Record<string, unknown>>;
	readonly collaboration?: { readonly runId: string };
	readonly authority?: ManagementAuthority;
	readonly signal: AbortSignal;
};
const fail = (message: string): never => {
	throw new ProtocolError("invalid_request", message);
};
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value !== null && typeof value === "object")
		return `{${Object.entries(value)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
			.join(",")}}`;
	return JSON.stringify(value);
}
export class BotManagement {
	readonly runtime: BotRuntime;
	readonly targetId: string;
	readonly now: () => number;
	constructor(runtime: BotRuntime, targetId: string, now: () => number) {
		this.runtime = runtime;
		this.targetId = targetId;
		this.now = now;
	}
	async authorize(call: ManagementCall, requireActive = true): Promise<void> {
		call.signal.throwIfAborted();
		const actor = await this.runtime.getBot(call.botId);
		if (actor?.kind !== "core" || actor.status !== "active" || (await this.runtime.conversationKey(call.botId)) !== call.conversationId)
			fail("Only the Core Bot can manage Bots");
		if (call.authority?.origin !== "user") fail("Bot management requires a user request");
		if (!requireActive) return;
		const run = await this.runtime.runsStore().get(call.authority!.runId);
		if (!run || run.botId !== call.botId || run.origin !== "user" || (run.channelId ?? "direct") !== "direct" || (requireActive && run.state !== "running"))
			fail("The originating user Run is no longer active");
	}
	key(call: ManagementCall): string {
		return `${call.conversationId}:${call.callId}`;
	}
	fingerprint(call: ManagementCall): string {
		return createHash("sha256")
			.update(
				canonical({
					actorId: call.botId,
					conversationId: call.conversationId,
					authority: call.authority,
					targetId: this.targetId,
					tool: call.tool,
					args: call.args,
				}),
			)
			.digest("hex");
	}
	async prepare(call: ManagementCall): Promise<Decision> {
		try {
			const saved = await this.runtime.management().get(this.key(call));
			await this.authorize(call, !saved?.result);
			if (call.tool === "bot_inspect") {
				if (Object.keys(call.args).some((k) => k !== "botId") || (call.args.botId != null && typeof call.args.botId !== "string"))
					fail("Invalid inspection arguments");
				return { kind: "allow" };
			}
			const action =
				call.tool === "bot_create" ? "create" : call.tool === "bot_update" ? "update" : call.tool === "bot_delete" ? "delete" : undefined;
			if (!action) fail("Unknown management tool");
			if (saved) {
				if (saved.fingerprint !== this.fingerprint(call)) fail("Management invocation arguments changed");
				if (saved.outcome) return { kind: "deny", reason: "This management request already ended" };
				return saved.result ? { kind: "allow" } : { kind: "ask", reason: "Review this Bot change" };
			}
			const { botId, expectedRevision, useDefaultModel, ...fields } = call.args;
			validateChange(fields);
			const change = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null));
			if (useDefaultModel !== undefined && useDefaultModel !== null && typeof useDefaultModel !== "boolean")
				fail("Invalid default model choice");
			if (useDefaultModel === true) {
				if (change.model) fail("Choose either a model override or the default model");
				change.model = null;
			}
			if (action !== "update" && useDefaultModel !== undefined) fail("Only updates accept a default model choice");
			validateChange(change);
			if (action === "create") {
				if (botId !== undefined || expectedRevision !== undefined || typeof change.name !== "string" || !change.name.trim())
					fail("Creation needs a name and no existing Bot ID or revision");
			} else {
				if (typeof botId !== "string" || !Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 1)
					fail("Inspect the Bot and supply its current revision");
				const bot = await this.runtime.getBot(botId as string);
				if (!bot || bot.status === "deleted") fail("Bot no longer exists");
				if (bot!.kind === "core") fail("Management tools cannot change the Core Bot");
				if (bot!.revision !== expectedRevision) fail("Bot changed. Inspect it again before proposing another change.");
				if (action === "delete" && Object.keys(fields).length) fail("Deletion cannot change profile fields");
				if (action === "update" && !Object.keys(change).length) fail("No profile changes supplied");
			}
			const selectedModel = change.model as ModelRef | null | undefined;
			if (
				selectedModel &&
				!this.runtime.listChatModels().some((m) => m.provider === selectedModel.provider && m.modelId === selectedModel.modelId)
			)
				fail("Choose a model from the configured catalog");
			const proposal: BotManagementProposal = {
				invocationId: this.key(call),
				approvalId: `approval:${this.key(call)}`,
				actorId: call.botId,
				conversationId: call.conversationId,
				runId: call.authority!.runId,
				origin: "user",
				targetId: this.targetId,
				botId: action === "create" ? `bot_managed_${createHash("sha256").update(this.key(call)).digest("hex")}` : (botId as string),
				action: action as BotManagementProposal["action"],
				expectedRevision: action === "create" ? 0 : (expectedRevision as number),
				change: change as BotManagementChange,
				createdAt: this.now(),
				fingerprint: this.fingerprint(call),
			};
			await this.runtime.management().propose(proposal);
			return { kind: "ask", reason: "Review this Bot change" };
		} catch (error) {
			if (call.signal.aborted) throw error;
			return { kind: "deny", reason: error instanceof ProtocolError ? error.message : "Bot management is unavailable" };
		}
	}
	async confirmed(call: ManagementCall): Promise<BotManagementProposal> {
		const proposal = await this.runtime.management().get(this.key(call));
		await this.authorize(call, !proposal?.result);
		if (!proposal || proposal.fingerprint !== this.fingerprint(call)) fail("Management proposal mismatch");
		if (proposal!.result) return proposal!;
		if (proposal!.outcome) fail("This management request already ended");
		const approval = await this.runtime.approvals().get(proposal!.approvalId);
		if (
			approval?.decision !== "allow_once" ||
			approval.botId !== call.botId ||
			approval.tool !== call.tool ||
			approval.target.kind !== "local" ||
			approval.target.targetId !== this.targetId ||
			canonical(approval.args) !== canonical(call.args)
		)
			fail("This exact Bot change needs user approval");
		if (proposal!.action !== "create") {
			const target = await this.runtime.getBot(proposal!.botId);
			if (!target || target.kind === "core" || target.status === "deleted" || target.revision !== proposal!.expectedRevision)
				fail("Bot changed. Inspect it again before proposing another change.");
		}
		call.signal.throwIfAborted();
		return proposal!;
	}
	async settled(botId: string, callId: string, status: string): Promise<void> {
		const id = `${await this.runtime.conversationKey(botId)}:${callId}`;
		const record = await this.runtime.management().get(id);
		if (!record || record.result || record.outcome) return;
		const approval = await this.runtime.approvals().get(record.approvalId);
		await this.runtime
			.management()
			.settle(id, approval?.decision === "deny" ? "denied" : status === "cancelled" ? "cancelled" : "failed", this.now());
	}
	async history(): Promise<BotManagementActivity[]> {
		const records = (await this.runtime.management().list()).sort((a, b) => b.createdAt - a.createdAt).slice(0, 100);
		return Promise.all(
			records.map(async (record) => {
				const approval = await this.runtime.approvals().get(record.approvalId);
				const run = await this.runtime.runsStore().get(record.runId);
				const { change: _change, fingerprint: _fingerprint, approvalId: _approvalId, result, ...metadata } = record;
				const outcome = result
					? "succeeded"
					: (record.outcome ??
						(approval?.decision === "deny"
							? "denied"
							: approval?.state === "withdrawn" || run?.state === "cancelled"
								? "cancelled"
								: run?.state === "running"
									? "pending"
									: "failed"));
				return { ...metadata, outcome, ...(result ? { resultRevision: result.revision } : {}) };
			}),
		);
	}
}
function validateChange(change: Record<string, unknown>): void {
	for (const [key, value] of Object.entries(change)) {
		if (value === null && ["name", "role", "instructions", "model", "thinkingLevel"].includes(key)) continue;
		if (["name", "role", "instructions"].includes(key)) {
			const max = key === "name" ? 100 : key === "role" ? 500 : 32000;
			if (typeof value !== "string" || value.length > max || (key === "name" && !value.trim())) fail("Invalid profile text");
		} else if (key === "thinkingLevel") {
			if (!["off", "low", "medium", "high"].includes(String(value))) fail("Invalid thinking level");
		} else if (key === "model") {
			if (
				value !== null &&
				(typeof value !== "object" ||
					Array.isArray(value) ||
					Object.keys(value).sort().join(",") !== "modelId,provider" ||
					!Object.values(value).every((v) => typeof v === "string" && v.length > 0))
			)
				fail("Invalid model reference");
		} else fail("This profile field cannot be changed by management tools");
	}
}

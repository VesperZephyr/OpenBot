import { createHash } from "node:crypto";
import { APP_CODE_VERSION, ProtocolError } from "@openbot/protocol";
import { RunsDoc } from "./runs.ts";
import { BotsDoc } from "./bots.ts";
import { ApprovalsDoc } from "./approvals.ts";
import { defineDoc } from "@earendil-works/pi-durable";
import type { AppExecution } from "@openbot/protocol";
export const AppExecutionsDoc = defineDoc<{ executions: Record<string, AppExecution> }>({
	kind: "openbot.app-executions",
	version: 1,
	scope: "session",
	initial: () => ({ executions: {} }),
});

/** The mutation and its receipt commit only while the same admitted parent and exact approval remain valid. */
export async function validateAppMutation(
	tx: import("@earendil-works/pi-durable").Tx,
	binding: import("@openbot/protocol").AppMutationBinding | undefined,
	approvalId: string,
) {
	if (!binding) return;
	const parent = (await tx.doc(AppExecutionsDoc)).executions[binding.executionId];
	const child = parent?.children.find((c) => c.callId === binding.callId);
	const run = parent && (await tx.doc(RunsDoc)).runs[parent.authority.runId];
	const approval = (await tx.doc(ApprovalsDoc)).approvals[approvalId];
	const bot = parent && (await tx.doc(BotsDoc)).bots[parent.botId];
	if (
		!parent ||
		parent.state !== "running" ||
		parent.version !== APP_CODE_VERSION ||
		parent.authority.channelId !== "direct" ||
		parent.authority.origin !== "user" ||
		parent.managementClosed ||
		parent.deadline <= Date.now() ||
		!child ||
		child.digest !== binding.digest ||
		!run ||
		run.state !== "running" ||
		run.botId !== parent.botId ||
		run.origin !== "user" ||
		(run.channelId ?? "direct") !== "direct" ||
		run.requestIds[0] !== parent.authority.rootRequestId ||
		bot?.kind !== "core" ||
		bot.status !== "active" ||
		String(bot.conversationId) !== parent.conversationId ||
		!approval ||
		approval.decision !== "allow_once" ||
		!["allowed", "consumed"].includes(approval.state) ||
		approval.botId !== parent.botId ||
		approval.conversationId !== parent.conversationId ||
		approval.callId !== child.callId ||
		approval.tool !== child.capability ||
		approval.target.kind !== "local" ||
		approval.target.targetId !== parent.targetId ||
		appChildDigest(parent, approval.tool, approval.args) !== binding.digest
	)
		throw new ProtocolError("request_conflict", "Application mutation authority expired or changed");
}
export const appChildDigest = (parent: AppExecution, tool: string, args: unknown) =>
	createHash("sha256")
		.update(JSON.stringify([APP_CODE_VERSION, tool, args, parent.authority, parent.targetId, parent.executionId]))
		.digest("hex");

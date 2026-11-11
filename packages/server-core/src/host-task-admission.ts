import { ProtocolError, type ToolInvocation } from "@openbot/protocol";

export type TaskAdmissionHost = {
	runtime: {
		runsStore(): { get(runId: string): Promise<{ taskId?: string; origin?: string } | undefined> };
		channels(): Promise<readonly { conversationId: string | number; kind?: string }[]>;
		policy(): { settings(): Promise<{ revision: number }> };
	};
	readonly status: { readonly targetId: string };
	authority: { change<T>(fn: () => Promise<T>): Promise<T> };
	lifecycle: { assertAllowed(): void };
	approvals: { rejection(id: string): Promise<string | undefined> };
	tasks: { assertExecution(call: ToolInvocation): Promise<unknown> };
};

/** A task Run is admitted on the authority line; every other call sends immediately. */
export async function admitHostTask(
	host: TaskAdmissionHost,
	invocation: ToolInvocation,
	signal: AbortSignal,
	send: () => void,
): Promise<void> {
	const run = invocation.runId ? await host.runtime.runsStore().get(invocation.runId) : undefined;
	const channel = (await host.runtime.channels()).find((item) => String(item.conversationId) === invocation.conversationId);
	if (channel?.kind !== "task" && !run?.taskId && run?.origin !== "task") {
		signal.throwIfAborted();
		send();
		return;
	}
	await host.authority.change(async () => {
		host.lifecycle.assertAllowed();
		if (
			invocation.target.kind !== "local" ||
			invocation.target.targetId !== host.status.targetId ||
			invocation.authorityRevision !== (await host.runtime.policy().settings()).revision
		)
			throw new ProtocolError("permission_revoked", "Task authority changed before dispatch");
		const rejection = await host.approvals.rejection(`approval:${invocation.invocationId}`);
		if (rejection) throw new ProtocolError("permission_revoked", rejection);
		await host.tasks.assertExecution({ ...invocation, tool: invocation.tool, args: invocation.args });
		signal.throwIfAborted();
		send();
	});
}

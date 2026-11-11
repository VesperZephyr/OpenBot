import { randomUUID } from "node:crypto";
import { paramsError } from "@openbot/protocol/schemas";
import { TEMPLATE_LIMITS, templateIpcSize, type HostMethod, type HostParams, type HostResult, ProtocolError } from "@openbot/protocol";
import type { OperationAudit } from "./host-ports.ts";

/** Mutations that share the bot-change queue. Other mutations do not. */
export const SERIALIZED_HOST_METHODS = [
	"bots.templates.import",
	"bots.create",
	"bots.update",
	"bots.duplicate",
	"bots.delete",
	"conversations.delete",
	"conversations.reopen",
	"messages.submit",
	"groups.change",
	"groups.send",
] as const satisfies readonly HostMethod[];

/** Projections that must not refresh observation or write an audit row, beyond the `.get` / `.list` / `.history` suffixes. */
const QUIET_HOST_METHODS = [
	"observation.wait",
	"artifacts.preview",
	"host.status",
	"groups.snapshot",
	"conversations.snapshot",
	"conversations.subscribe",
	"conversations.markRead",
	"conversations.search",
	"files.resolveReveal",
] as const satisfies readonly HostMethod[];

export type HostHandlers = { [M in HostMethod]: (params: HostParams<M>) => Promise<HostResult<M>> };

export type HostDispatchState = {
	readonly handlers: HostHandlers;
	now(): number;
	audit(event: OperationAudit): void;
	/** Topic 8: a committed mutation is visible to observation subscribers. */
	noteMutation(): void;
	serialize<T>(work: () => Promise<T>): Promise<T>;
	templateOperations(): number;
	setTemplateOperations(count: number): void;
};

export function isTemplateHostMethod(method: string): boolean {
	return method.startsWith("bots.templates.") || method.startsWith("templates.file.");
}

export function hostMethodSerializes(method: string): boolean {
	return (SERIALIZED_HOST_METHODS as readonly string[]).includes(method);
}

export function hostMethodAudited(method: string): boolean {
	return (
		!method.endsWith(".get") &&
		!method.endsWith(".list") &&
		!method.endsWith(".history") &&
		!(QUIET_HOST_METHODS as readonly string[]).includes(method)
	);
}

/**
 * One validated request. A rejected template check does not take a slot and is not audited; the slot is released
 * after the handler settles, including when the result exceeds the IPC limit.
 */
export async function dispatchHostRequest<M extends HostMethod>(
	state: HostDispatchState,
	method: M,
	params: HostParams<M>,
): Promise<HostResult<M>> {
	const handler: HostHandlers[M] | undefined = state.handlers[method];
	if (handler === undefined) throw new ProtocolError("unknown_method", `Unknown method: ${method}`);
	const templateOperation = isTemplateHostMethod(method);
	if (templateOperation) {
		if (paramsError(method, params)) throw new ProtocolError("invalid_request", "Invalid Bot template or import choices");
		if (state.templateOperations() >= TEMPLATE_LIMITS.operations)
			throw new ProtocolError("invalid_request", "Too many template operations; try again");
		state.setTemplateOperations(state.templateOperations() + 1);
	}
	const at = state.now();
	let outcome: "succeeded" | "failed" = "failed";
	try {
		const result = await (hostMethodSerializes(method) ? state.serialize(() => handler(params)) : handler(params));
		if (templateOperation && !templateIpcSize(result)) throw new ProtocolError("invalid_request", "Bot template exceeds the IPC limit");
		outcome = method === "models.test" && (result as { ok?: boolean }).ok === false ? "failed" : "succeeded";
		return result;
	} finally {
		if (templateOperation) state.setTemplateOperations(state.templateOperations() - 1);
		if (hostMethodAudited(method)) {
			try {
				if (outcome === "succeeded") state.noteMutation();
				state.audit({ operationId: randomUUID(), operation: method, at, durationMs: state.now() - at, outcome });
			} catch {
				/* Diagnostics must not undo a committed action. */
			}
		}
	}
}

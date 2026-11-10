import { ProtocolError } from "./errors.ts";

/** The execution destination every invocation, grant, and approval is bound to. */
export type ExecutionTarget = { readonly kind: "local"; readonly targetId: string };

/** Accepts only the bound local target; any other kind or identity is a hard error. */
export function assertLocalTarget(target: ExecutionTarget, boundTargetId: string): void {
	if (target.kind !== "local") throw new ProtocolError("target_unsupported", `Unsupported target kind: ${target.kind}`);
	if (target.targetId !== boundTargetId) {
		throw new ProtocolError("target_mismatch", `Target ${target.targetId} is not the bound local target`);
	}
}

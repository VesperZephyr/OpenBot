import { ProtocolError, type HostError } from "@openbot/protocol";

/** A handler failure as the Host response error. Only `ProtocolError` keeps its code; every other throw is `internal`. */
export function hostError(error: unknown): HostError {
	if (error instanceof ProtocolError) {
		return error.details === undefined
			? { code: error.code, message: error.message }
			: { code: error.code, message: error.message, details: error.details };
	}
	return { code: "internal", message: error instanceof Error ? error.message : String(error) };
}

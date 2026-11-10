

export type ProtocolErrorCode =
	| "approval_expired"
 | "permission_revoked"
 | "approval_denied"
	| "target_unsupported"
	| "target_mismatch"
	| "request_conflict"
	| "not_found"
	| "invalid_request"
	| "unknown_method"
	| "host_unavailable"
	| "internal";

/** Optional facts a caller can use without parsing the message. `currentRevision` is the stored revision that rejected a stale write. */
export type ProtocolErrorDetails = {
	readonly currentRevision?: number;
};

/** The error object on a failed Host response. */
export type HostError = {
	readonly code: ProtocolErrorCode;
	readonly message: string;
	readonly details?: ProtocolErrorDetails;
};

export class ProtocolError extends Error {
	readonly code: ProtocolErrorCode;
	readonly details?: ProtocolErrorDetails;

	constructor(code: ProtocolErrorCode, message: string, details?: ProtocolErrorDetails) {
		super(message);
		this.name = "ProtocolError";
		this.code = code;
		if (details !== undefined) this.details = details;
	}
}

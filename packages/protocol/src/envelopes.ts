import type { HostError } from "./errors.ts";
import type { HostEvent } from "./host-events.ts";
import type { HostMethod, HostParams, HostResult, HostStatus } from "./host-methods.ts";
import { PROTOCOL_VERSION } from "./version.ts";

// ---------------------------------------------------------------------------
// Envelopes

export type RequestEnvelope<M extends HostMethod = HostMethod> = {
	readonly protocolVersion: typeof PROTOCOL_VERSION;
	readonly kind: "request";
	readonly messageId: string;
	readonly method: M;
	readonly params: HostParams<M>;
};

export type ResponseEnvelope<M extends HostMethod = HostMethod> =
	| {
			readonly protocolVersion: typeof PROTOCOL_VERSION;
			readonly kind: "response";
			readonly messageId: string;
			readonly ok: true;
			readonly result: HostResult<M>;
	  }
	| {
			readonly protocolVersion: typeof PROTOCOL_VERSION;
			readonly kind: "response";
			readonly messageId: string;
			readonly ok: false;
			readonly error: HostError;
	  };

/** Ordered event; a gap in `seq` or a new `streamId` requires fresh snapshots. */
export type EventEnvelope = HostEvent & {
	readonly protocolVersion: typeof PROTOCOL_VERSION;
	readonly kind: "event";
	readonly streamId: string;
	readonly seq: number;
};

/** Sent once by the Host after it opened storage and is ready for requests. */
export type ReadyEnvelope = {
	readonly protocolVersion: typeof PROTOCOL_VERSION;
	readonly kind: "ready";
	readonly status: HostStatus;
};

export type HostToDesktop = ResponseEnvelope | EventEnvelope | ReadyEnvelope;

/**
 * Shape check for an incoming request envelope. The method is only checked to be a string and `params` only to be
 * present, so a request for an unknown method or with malformed params still gets a response (`unknown_method`, or
 * `invalid_request` from the method's schema in `schemas.ts`) instead of being dropped.
 */
export function isRequestEnvelope(
	value: unknown,
): value is Omit<RequestEnvelope, "method" | "params"> & { readonly method: string; readonly params: unknown } {
	if (typeof value !== "object" || value === null) return false;
	return (
		"protocolVersion" in value &&
		value.protocolVersion === PROTOCOL_VERSION &&
		"kind" in value &&
		value.kind === "request" &&
		"messageId" in value &&
		typeof value.messageId === "string" &&
		"method" in value &&
		typeof value.method === "string" &&
		"params" in value
	);
}

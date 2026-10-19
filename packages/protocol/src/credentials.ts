/** Private Desktop/Host channel. These operations are never Host methods or model capabilities. */
export const CREDENTIAL_LIMITS = { pending: 8, timeoutMs: 10_000, ids: 256, secretBytes: 16_384 } as const;
export const CREDENTIAL_ERRORS = [
	"unavailable",
	"denied",
	"invalid_request",
	"metadata_error",
	"migration_required",
	"cleanup_required",
	"unconfirmed",
	"busy",
] as const;
export type CredentialErrorCode = (typeof CREDENTIAL_ERRORS)[number];
export type CredentialStatus = {
	readonly owner: "desktop-main";
	readonly availability: "ready" | "unavailable" | "metadata_error";
	readonly configuredCount: number;
	readonly legacyCount: number;
	readonly migrationRequired: number;
};
export type CredentialMigration = {
	readonly migrated: number;
	readonly blocked: number;
	readonly cleanupPending: number;
	readonly status: CredentialStatus;
};
export type CredentialOperations = {
	list: { params: Record<string, never>; result: { ids: readonly string[]; status: CredentialStatus } };
	status: { params: Record<string, never>; result: CredentialStatus };
	get: { params: { id: string }; result: { value: string | null } };
	set: { params: { id: string; value: string }; result: null };
	delete: { params: { id: string }; result: null };
	migrate: { params: Record<string, never>; result: CredentialMigration };
};
export type CredentialOperation = keyof CredentialOperations;
export type CredentialRequest = {
	[K in CredentialOperation]: { kind: "credential.request"; requestId: string; operation: K; params: CredentialOperations[K]["params"] };
}[CredentialOperation];
export type CredentialResponse = { kind: "credential.response"; requestId: string } & (
	| { ok: true; result: unknown }
	| { ok: false; code: CredentialErrorCode }
);

const encoder = new TextEncoder();
export function credentialId(value: unknown): value is string {
	return (
		typeof value === "string" &&
		(/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value) || value === "search:tavily" || /^connector:[a-z][a-z0-9-]{0,31}$/.test(value))
	);
}
export function credentialSecret(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= CREDENTIAL_LIMITS.secretBytes &&
		value.isWellFormed() &&
		!value.includes("\0") &&
		encoder.encode(value).length <= CREDENTIAL_LIMITS.secretBytes
	);
}
function object(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
	return object(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
const count = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= CREDENTIAL_LIMITS.ids;
export function credentialStatus(value: unknown): value is CredentialStatus {
	return (
		exact(value, ["owner", "availability", "configuredCount", "legacyCount", "migrationRequired"]) &&
		value.owner === "desktop-main" &&
		["ready", "unavailable", "metadata_error"].includes(String(value.availability)) &&
		count(value.configuredCount) &&
		count(value.legacyCount) &&
		count(value.migrationRequired) &&
		value.migrationRequired <= value.legacyCount
	);
}
export function credentialResult(operation: CredentialOperation, value: unknown): boolean {
	switch (operation) {
		case "status":
			return credentialStatus(value);
		case "list":
			return (
				exact(value, ["ids", "status"]) &&
				Array.isArray(value.ids) &&
				value.ids.length <= CREDENTIAL_LIMITS.ids &&
				value.ids.every(credentialId) &&
				new Set(value.ids).size === value.ids.length &&
				credentialStatus(value.status)
			);
		case "get":
			return exact(value, ["value"]) && (value.value === null || credentialSecret(value.value));
		case "set":
		case "delete":
			return value === null;
		case "migrate":
			return (
				exact(value, ["migrated", "blocked", "cleanupPending", "status"]) &&
				count(value.migrated) &&
				count(value.blocked) &&
				count(value.cleanupPending) &&
				credentialStatus(value.status)
			);
	}
}
export function isCredentialRequest(value: unknown): value is CredentialRequest {
	if (
		!exact(value, ["kind", "requestId", "operation", "params"]) ||
		value.kind !== "credential.request" ||
		typeof value.requestId !== "string" ||
		!/^[a-zA-Z0-9_-]{1,80}$/.test(value.requestId)
	)
		return false;
	switch (value.operation) {
		case "list":
		case "status":
		case "migrate":
			return exact(value.params, []);
		case "get":
		case "delete":
			return exact(value.params, ["id"]) && credentialId(value.params.id);
		case "set":
			return exact(value.params, ["id", "value"]) && credentialId(value.params.id) && credentialSecret(value.params.value);
		default:
			return false;
	}
}
export function isCredentialResponse(value: unknown, operation: CredentialOperation): value is CredentialResponse {
	if (!object(value) || value.kind !== "credential.response" || typeof value.requestId !== "string") return false;
	return value.ok === true
		? exact(value, ["kind", "requestId", "ok", "result"]) && credentialResult(operation, value.result)
		: value.ok === false &&
				exact(value, ["kind", "requestId", "ok", "code"]) &&
				CREDENTIAL_ERRORS.includes(value.code as CredentialErrorCode);
}

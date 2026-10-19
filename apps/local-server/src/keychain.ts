/** Host credential adapter: the only storage transport is the private, supervised Desktop parent. */
import { randomUUID } from "node:crypto";
import type { Credential, CredentialInfo, CredentialStore } from "@openbot/agent-runtime";
import {
	CREDENTIAL_LIMITS,
	credentialId,
	isCredentialRequest,
	isCredentialResponse,
	type CredentialOperation,
	type CredentialOperations,
	type CredentialRequest,
	type CredentialErrorCode,
	ProtocolError,
} from "@openbot/protocol";
import type { SecretStore } from "@openbot/server-core";

const messages: Record<CredentialErrorCode, string> = {
	unavailable: "Credential storage is unavailable. Unlock your Keychain and retry.",
	denied: "Keychain access was denied. Re-enter the credential in Settings or unlock your Keychain and retry.",
	invalid_request: "Invalid credential request.",
	metadata_error: "Credential metadata is missing or damaged. Restore the local credential indexes before retrying.",
	migration_required: "Saved credentials need migration. Open Settings to migrate or re-enter the value.",
	cleanup_required: "The new credential is saved, but legacy cleanup is unconfirmed. Retry migration in Settings.",
	unconfirmed: "Credential operation is unconfirmed. Check storage status and explicitly retry.",
	busy: "Credential storage is busy. Retry shortly.",
};
export interface CredentialTransport {
	send(message: CredentialRequest): void;
	on(event: "message", listener: (message: unknown) => void): unknown;
	on(event: "disconnect", listener: () => void): unknown;
}
export class CredentialBroker {
	readonly #pending = new Map<
		string,
		{ operation: CredentialOperation; resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
	>();
	#closed = false;
	readonly transport: CredentialTransport;
	readonly timeoutMs: number;
	constructor(transport: CredentialTransport, timeoutMs: number = CREDENTIAL_LIMITS.timeoutMs) {
		this.transport = transport;
		this.timeoutMs = timeoutMs;
		transport.on("message", (message) => this.#receive(message));
		transport.on("disconnect", () => this.close());
	}
	async request<K extends CredentialOperation>(
		operation: K,
		params: CredentialOperations[K]["params"],
	): Promise<CredentialOperations[K]["result"]> {
		if (this.#closed) throw new ProtocolError("host_unavailable", messages.unavailable);
		if (this.#pending.size >= CREDENTIAL_LIMITS.pending) throw new ProtocolError("host_unavailable", messages.busy);
		const requestId = randomUUID();
		const request = { kind: "credential.request", requestId, operation, params };
		if (!isCredentialRequest(request)) throw new ProtocolError("invalid_request", messages.invalid_request);
		const result = Promise.withResolvers<unknown>();
		const timer = setTimeout(() => {
			this.#pending.delete(requestId);
			result.reject(new ProtocolError("host_unavailable", messages.unconfirmed));
		}, this.timeoutMs);
		this.#pending.set(requestId, { operation, ...result, timer });
		try {
			this.transport.send(request);
		} catch {
			this.close();
		}
		return (await result.promise) as CredentialOperations[K]["result"];
	}
	#receive(message: unknown): void {
		if (
			!message ||
			typeof message !== "object" ||
			!("kind" in message) ||
			message.kind !== "credential.response" ||
			!("requestId" in message) ||
			typeof message.requestId !== "string"
		)
			return;
		const pending = this.#pending.get(message.requestId);
		if (!pending) return;
		this.#pending.delete(message.requestId);
		clearTimeout(pending.timer);
		if (!isCredentialResponse(message, pending.operation)) {
			pending.reject(new ProtocolError("invalid_request", messages.invalid_request));
			return;
		}
		if (message.ok) pending.resolve(message.result);
		else pending.reject(new ProtocolError("host_unavailable", messages[message.code]));
	}
	close(): void {
		this.#closed = true;
		for (const pending of this.#pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(new ProtocolError("host_unavailable", messages.unconfirmed));
		}
		this.#pending.clear();
	}
}

const modelId = (id: string): boolean => credentialId(id) && !id.includes(":");
export class KeychainCredentials implements SecretStore, CredentialStore {
	readonly #chains = new Map<string, Promise<unknown>>();
	readonly broker: Pick<CredentialBroker, "request">;
	constructor(broker: Pick<CredentialBroker, "request">) {
		this.broker = broker;
	}
	async configuredProviders(): Promise<ReadonlySet<string>> {
		return new Set((await this.broker.request("list", {})).ids);
	}
	async setApiKey(id: string, value: string): Promise<void> {
		await this.broker.request("set", { id, value });
	}
	async deleteApiKey(id: string): Promise<void> {
		await this.broker.request("delete", { id });
	}
	async getApiKey(id: string): Promise<string | undefined> {
		return (await this.broker.request("get", { id })).value ?? undefined;
	}
	status() {
		return this.broker.request("status", {});
	}
	migrate() {
		return this.broker.request("migrate", {});
	}
	async read(id: string): Promise<Credential | undefined> {
		if (!modelId(id)) return undefined;
		const key = await this.getApiKey(id);
		return key === undefined ? undefined : { type: "api_key", key };
	}
	async list(): Promise<readonly CredentialInfo[]> {
		return [...(await this.configuredProviders())].filter(modelId).map((providerId) => ({ providerId, type: "api_key" as const }));
	}
	modify(id: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>): Promise<Credential | undefined> {
		if (!modelId(id)) return Promise.reject(new Error("Reserved credential namespace"));
		const next = (this.#chains.get(id) ?? Promise.resolve())
			.catch(() => {})
			.then(async () => {
				const current = await this.read(id),
					value = await fn(current);
				if (!value || value.type !== "api_key" || value.key === undefined) return current;
				await this.setApiKey(id, value.key);
				return value;
			});
		const settled = next.then(
			() => {},
			() => {},
		);
		this.#chains.set(id, settled);
		void settled.then(() => {
			if (this.#chains.get(id) === settled) this.#chains.delete(id);
		});
		return next;
	}
	async delete(id: string): Promise<void> {
		if (!modelId(id)) throw new Error("Reserved credential namespace");
		await this.deleteApiKey(id);
	}
}

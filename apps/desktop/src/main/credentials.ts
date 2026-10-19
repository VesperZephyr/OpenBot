import { constants } from "node:fs";
import { mkdir, open, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
	CREDENTIAL_LIMITS,
	credentialId,
	credentialSecret,
	isCredentialRequest,
	type CredentialRequest,
	type CredentialResponse,
	type CredentialStatus,
	type CredentialErrorCode,
} from "@openbot/protocol";

export interface NativeKeychain {
	access(operation: "get" | "set" | "delete", service: string, account: string, value?: string): Promise<string | null>;
}
export class CredentialFailure extends Error {
	readonly code: CredentialErrorCode;
	constructor(code: CredentialErrorCode) {
		super(code);
		this.code = code;
	}
}
const fail: (code: CredentialErrorCode) => never = (code) => {
	throw new CredentialFailure(code);
};

/** One queue owns both indexes, including migration cleanup. No secret is ever serialized to disk. */
export class DesktopCredentials {
	#tail: Promise<unknown> = Promise.resolve();
	#pending = 0;
	#unavailable = false;
	readonly #service: string;
	readonly directory: string;
	readonly native: NativeKeychain;
	constructor(directory: string, service: string, native: NativeKeychain) {
		this.directory = directory;
		this.native = native;
		if (!/^[a-zA-Z0-9._-]{1,240}$/.test(service)) fail("invalid_request");
		this.#service = service;
	}

	async handle(message: CredentialRequest, active: () => boolean = () => true): Promise<CredentialResponse> {
		const requestId = message.requestId;
		if (!isCredentialRequest(message)) return { kind: "credential.response", requestId, ok: false, code: "invalid_request" };
		if (this.#pending >= CREDENTIAL_LIMITS.pending)
			return { kind: "credential.response", requestId: message.requestId, ok: false, code: "busy" };
		this.#pending++;
		const deadline = Date.now() + CREDENTIAL_LIMITS.timeoutMs;
		const task = this.#tail
			.catch(() => {})
			.then(async () => {
				if (!active() || Date.now() >= deadline) fail("unconfirmed");
				return this.#execute(message);
			});
		this.#tail = task.then(
			() => {},
			() => {},
		);
		try {
			return { kind: "credential.response", requestId: message.requestId, ok: true, result: await task };
		} catch (error) {
			return {
				kind: "credential.response",
				requestId: message.requestId,
				ok: false,
				code: error instanceof CredentialFailure ? error.code : "unavailable",
			};
		} finally {
			this.#pending--;
		}
	}

	async #read(name: string): Promise<string[] | undefined> {
		let file;
		try {
			file = await open(join(this.directory, name), constants.O_RDONLY | constants.O_NOFOLLOW);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
			return fail("metadata_error");
		}
		try {
			const info = await file.stat();
			if (!info.isFile() || info.size > 32768) fail("metadata_error");
			const value: unknown = JSON.parse(await file.readFile("utf8"));
			if (
				!Array.isArray(value) ||
				value.length > CREDENTIAL_LIMITS.ids ||
				!value.every(credentialId) ||
				new Set(value).size !== value.length
			)
				fail("metadata_error");
			return value as string[];
		} catch {
			return fail("metadata_error");
		} finally {
			await file.close();
		}
	}

	async #write(name: string, ids: readonly string[]): Promise<void> {
		const temporary = join(this.directory, `.${name}.${randomUUID()}`);
		try {
			const file = await open(temporary, "wx", 0o600);
			try {
				await file.writeFile(`${JSON.stringify([...ids].sort())}\n`);
				await file.sync();
			} finally {
				await file.close();
			}
			await rename(temporary, join(this.directory, name));
			const directory = await open(this.directory, "r");
			try {
				await directory.sync();
			} finally {
				await directory.close();
			}
		} catch {
			fail("metadata_error");
		}
	}

	async #indexes(): Promise<{ current: Set<string>; legacy: Set<string> }> {
		await mkdir(this.directory, { recursive: true, mode: 0o700 });
		const current = await this.#read("credentials-v2.json");
		const legacy = await this.#read("credentials.json");
		// A durable marker distinguishes first upgrade from a missing index after initialization.
		const initialized = await stat(join(this.directory, ".credentials-v2-initialized")).then(
			() => true,
			(error) => {
				if (error.code === "ENOENT") return false;
				return fail("metadata_error");
			},
		);
		if ((initialized && (!current || !legacy)) || (current && !legacy)) fail("metadata_error");
		if (!legacy) await this.#write("credentials.json", []);
		if (!current) await this.#write("credentials-v2.json", []);
		if (new Set([...(current ?? []), ...(legacy ?? [])]).size > CREDENTIAL_LIMITS.ids) fail("metadata_error");
		if (!initialized) await this.#write(".credentials-v2-initialized", []);
		return { current: new Set(current), legacy: new Set(legacy) };
	}
	#status(current: Set<string>, legacy: Set<string>): CredentialStatus {
		return {
			owner: "desktop-main",
			availability: this.#unavailable ? "unavailable" : "ready",
			configuredCount: current.size,
			legacyCount: legacy.size,
			migrationRequired: [...legacy].filter((id) => !current.has(id)).length,
		};
	}
	async #native(operation: "get" | "set" | "delete", id: string, legacy = false, value?: string): Promise<string | null> {
		try {
			const result = await this.native.access(operation, legacy ? this.#service : `${this.#service}.v2`, id, value);
			if (operation === "get" ? result !== null && !credentialSecret(result) : result !== null) fail("unavailable");
			this.#unavailable = false;
			return result;
		} catch (error) {
			this.#unavailable = true;
			return fail(error instanceof Error && error.message === "denied" ? "denied" : "unavailable");
		}
	}
	async #store(id: string, value: string, current: Set<string>): Promise<void> {
		await this.#native("set", id, false, value);
		if ((await this.#native("get", id)) !== value) fail("unconfirmed");
		await this.#write("credentials-v2.json", [...new Set([...current, id])]);
		current.add(id);
	}
	async #cleanup(id: string, legacy: Set<string>): Promise<void> {
		await this.#native("delete", id, true);
		await this.#write(
			"credentials.json",
			[...legacy].filter((value) => value !== id),
		);
		legacy.delete(id);
	}
	async #execute(request: CredentialRequest): Promise<unknown> {
		let indexes;
		try {
			indexes = await this.#indexes();
		} catch (error) {
			if (request.operation === "status")
				return { owner: "desktop-main", availability: "metadata_error", configuredCount: 0, legacyCount: 0, migrationRequired: 0 };
			throw error;
		}
		const { current, legacy } = indexes;
		switch (request.operation) {
			case "status":
				return this.#status(current, legacy);
			case "list":
				return { ids: [...new Set([...current, ...legacy])].sort(), status: this.#status(current, legacy) };
			case "get": {
				const id = request.params.id;
				if (!current.has(id)) {
					if (legacy.has(id)) fail("migration_required");
					return { value: null };
				}
				const value = await this.#native("get", id);
				if (value === null) fail("unavailable");
				return { value };
			}
			case "set": {
				const { id, value } = request.params;
				if (!current.has(id) && !legacy.has(id) && new Set([...current, ...legacy]).size >= CREDENTIAL_LIMITS.ids) fail("busy");
				await this.#store(id, value, current);
				if (legacy.has(id)) {
					try {
						await this.#cleanup(id, legacy);
					} catch {
						fail("cleanup_required");
					}
				}
				return null;
			}
			case "delete": {
				const id = request.params.id;
				await this.#native("delete", id);
				await this.#write(
					"credentials-v2.json",
					[...current].filter((value) => value !== id),
				);
				current.delete(id);
				// Even an unindexed, interrupted write is removed by an explicit delete.
				await this.#cleanup(id, legacy);
				return null;
			}
			case "migrate": {
				let migrated = 0,
					blocked = 0,
					cleanupPending = 0;
				for (const id of [...legacy]) {
					try {
						// The native write may already have committed before an index write/restart.
						const existing = await this.#native("get", id);
						if (existing !== null) {
							await this.#write("credentials-v2.json", [...new Set([...current, id])]);
							current.add(id);
						} else {
							if (current.has(id)) fail("unavailable");
							const value = await this.#native("get", id, true);
							if (value === null) fail("unavailable");
							await this.#store(id, value, current);
						}
					} catch {
						blocked++;
						continue;
					}
					try {
						await this.#cleanup(id, legacy);
						migrated++;
					} catch {
						cleanupPending++;
					}
				}
				return { migrated, blocked, cleanupPending, status: this.#status(current, legacy) };
			}
		}
	}
}

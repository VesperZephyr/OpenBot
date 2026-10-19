import {CONNECTOR_CREDENTIAL_PREFIX} from "@openbot/protocol";
/**
 * macOS Keychain storage for provider API keys, through `/usr/bin/security`. Keys are passed on stdin, never on the
 * command line. Each provider's key is a generic password item under one service name.
 *
 * Section 5.9 of the architecture moves Keychain access into a dedicated signed helper or Electron main before
 * packaging; this implementation is the development path and keeps the same `SecretStore` port.
 */
import { execFile, spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import type { Credential, CredentialInfo, CredentialStore } from "@openbot/agent-runtime";
import { SEARCH_PROVIDER_PREFIX, type SecretStore } from "@openbot/server-core";

const run = promisify(execFile);
const SECURITY = "/usr/bin/security";

export type KeychainOptions = {
	/** Keychain service name; one item per provider ID is stored under it. */
	readonly service: string;
	/** JSON file listing provider IDs with a stored key, so listing never touches secret material. */
	readonly indexPath: string;
};

/** API keys in the Keychain, exposed both as the `SecretStore` port and as pi-ai's `CredentialStore`. */
export class KeychainCredentials implements SecretStore, CredentialStore {
	readonly #service: string;
	readonly #indexPath: string;
	/** Serializes writes per provider, as the `CredentialStore` contract requires. */
	readonly #chains = new Map<string, Promise<unknown>>();

	constructor(options: KeychainOptions) {
		this.#service = options.service;
		this.#indexPath = options.indexPath;
	}

	// --- SecretStore

	async configuredProviders(): Promise<ReadonlySet<string>> {
		return new Set(await this.#index());
	}

	async setApiKey(providerId: string, apiKey: string): Promise<void> {
		await this.#serialized(providerId, async () => {
			await this.#write(providerId, apiKey);
			await this.#updateIndex((ids) => ids.add(providerId));
		});
	}

	async deleteApiKey(providerId: string): Promise<void> {
		await this.#serialized(providerId, async () => {
			await this.#delete(providerId);
			await this.#updateIndex((ids) => ids.delete(providerId));
		});
	}

	async getApiKey(providerId: string): Promise<string | undefined> {
		return this.#find(providerId);
	}

	// --- CredentialStore (pi-ai)

	async read(providerId: string): Promise<Credential | undefined> {
 if(providerId.startsWith(SEARCH_PROVIDER_PREFIX)||providerId.startsWith(CONNECTOR_CREDENTIAL_PREFIX))return undefined;
		const key = await this.#find(providerId);
		return key === undefined ? undefined : { type: "api_key", key };
	}

	async list(): Promise<readonly CredentialInfo[]> {
		// Search keys share the store but are not model credentials.
		return (await this.#index())
			.filter((providerId) => !providerId.startsWith(SEARCH_PROVIDER_PREFIX)&&!providerId.startsWith(CONNECTOR_CREDENTIAL_PREFIX))
			.map((providerId) => ({ providerId, type: "api_key" as const }));
	}

	modify(
		providerId: string,
		fn: (current: Credential | undefined) => Promise<Credential | undefined>,
	): Promise<Credential | undefined> {
 if(providerId.startsWith(SEARCH_PROVIDER_PREFIX)||providerId.startsWith(CONNECTOR_CREDENTIAL_PREFIX))return Promise.reject(new Error("Reserved credential namespace"));
		return this.#serialized(providerId, async () => {
			const current = await this.read(providerId);
			const next = await fn(current);
			if (next === undefined) return current;
			// Only API keys are stored; OAuth providers are out of scope until a provider needs them.
			if (next.type !== "api_key" || next.key === undefined) return current;
			await this.#write(providerId, next.key);
			await this.#updateIndex((ids) => ids.add(providerId));
			return next;
		});
	}

	async delete(providerId: string): Promise<void> {
		await this.deleteApiKey(providerId);
	}

	// --- Keychain

	async #find(providerId: string): Promise<string | undefined> {
		try {
			const { stdout } = await run(SECURITY, ["find-generic-password", "-s", this.#service, "-a", providerId, "-w"]);
			return stdout.replace(/\n$/, "");
		} catch {
			return undefined;
		}
	}

	async #write(providerId: string, secret: string): Promise<void> {
		// With `-w` last and no value, `security` prompts twice on stdin; the secret never appears in argv.
		const child = spawn(SECURITY, ["add-generic-password", "-U", "-s", this.#service, "-a", providerId, "-w"], {
			stdio: ["pipe", "ignore", "pipe"],
		});
		let stderr = "";
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.stdin.end(`${secret}\n${secret}\n`);
		const { promise, resolve, reject } = Promise.withResolvers<void>();
		child.on("error", reject);
		child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`Keychain write failed: ${stderr.trim()}`))));
		await promise;
	}

	async #delete(providerId: string): Promise<void> {
		try {
			await run(SECURITY, ["delete-generic-password", "-s", this.#service, "-a", providerId]);
		} catch {
			// Already absent.
		}
	}

	async #index(): Promise<string[]> {
		try {
			const parsed: unknown = JSON.parse(await readFile(this.#indexPath, "utf8"));
			return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
		} catch {
			return [];
		}
	}

	async #updateIndex(change: (ids: Set<string>) => void): Promise<void> {
		const ids = new Set(await this.#index());
		change(ids);
		await writeFile(this.#indexPath, `${JSON.stringify([...ids].sort())}\n`, { mode: 0o600 });
	}

	#serialized<T>(providerId: string, task: () => Promise<T>): Promise<T> {
		const previous = this.#chains.get(providerId) ?? Promise.resolve();
		const next = previous.catch(() => {}).then(task);
		this.#chains.set(
			providerId,
			next.catch(() => {}),
		);
		return next;
	}
}

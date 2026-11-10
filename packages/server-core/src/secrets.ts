import type { SecretStore } from "./host-ports.ts";

/** In-memory `SecretStore` for tests and development without a Keychain. */
export class MemorySecretStore implements SecretStore {
	readonly #keys = new Map<string, string>();

	async configuredProviders(): Promise<ReadonlySet<string>> {
		return new Set(this.#keys.keys());
	}

	async setApiKey(providerId: string, apiKey: string): Promise<void> {
		this.#keys.set(providerId, apiKey);
	}

	async deleteApiKey(providerId: string): Promise<void> {
		this.#keys.delete(providerId);
	}

	async getApiKey(providerId: string): Promise<string | undefined> {
		return this.#keys.get(providerId);
	}
}

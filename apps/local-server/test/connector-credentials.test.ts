import { expect, it, vi } from "vitest";
import { KeychainCredentials, type CredentialBroker } from "../src/keychain.ts";
it("never exposes connector or search credentials through any Pi model credential method", async () => {
	const request = vi.fn(async () => ({ ids: ["model", "connector:notes", "search:tavily"] }));
	const store = new KeychainCredentials({ request } as unknown as CredentialBroker);
	expect(await store.list()).toEqual([{ providerId: "model", type: "api_key" }]);
	request.mockClear();
	for (const id of ["connector:notes", "search:tavily"]) {
		expect(await store.read(id)).toBeUndefined();
		const callback = vi.fn();
		await expect(store.modify(id, callback)).rejects.toThrow("Reserved");
		await expect(store.delete(id)).rejects.toThrow("Reserved");
		expect(callback).not.toHaveBeenCalled();
	}
	expect(request).not.toHaveBeenCalled();
});

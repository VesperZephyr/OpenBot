import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { KeychainCredentials } from "../src/keychain.ts";
it("never exposes connector or search credentials through Pi model credential methods", async () => {
	const root = await mkdtemp(join(tmpdir(), "openbot-key-index-"));
	try {
		const indexPath = join(root, "credentials.json");
		await writeFile(indexPath, JSON.stringify(["model", "connector:notes", "search:tavily"]));
		const store = new KeychainCredentials({ service: "ai.openbot.unit-unused", indexPath });
		expect(await store.list()).toEqual([{ providerId: "model", type: "api_key" }]);
		for (const id of ["connector:notes", "search:tavily"]) {
			expect(await store.read(id)).toBeUndefined();
			const callback = vi.fn();
			await expect(store.modify(id, callback)).rejects.toThrow("Reserved");
			expect(callback).not.toHaveBeenCalled();
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

import { describe, expect, it } from "vitest";
import { ComposerStore, COMPOSER_STORAGE_KEY } from "../src/renderer/src/composers";
const storage = () => {
	const values = new Map<string, string>();
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => {
			values.set(key, value);
		},
	};
};
describe("local composers", () => {
	it("isolates drafts by conversation kind and restores drafts without dispatch", () => {
		const disk = storage(),
			store = new ComposerStore(disk);
		store.edit("bot:same", { text: "private" });
		store.edit("group:same", { text: "群聊", recipientIds: ["alpha"] });
		const restored = new ComposerStore(disk);
		expect(restored.get("bot:same").draft.text).toBe("private");
		expect(restored.get("group:same").draft.recipientIds).toEqual(["alpha"]);
	});
	it("late acknowledgement or failure preserves newer text and recipients", async () => {
		const store = new ComposerStore(storage());
		store.edit("group:g", { text: "first", recipientIds: ["a"] });
		let done!: () => void;
		const pending = store.send(
			"group:g",
			() =>
				new Promise<void>((resolve) => {
					done = resolve;
				}),
		);
		let duplicateCalls = 0;
		expect(
			await store.send("group:g", async () => {
				duplicateCalls++;
			}),
		).toBe(false);
		expect(duplicateCalls).toBe(0);
		store.edit("group:g", { text: "next", recipientIds: ["b"] });
		done();
		await pending;
		expect(store.get("group:g").draft).toMatchObject({ text: "next", recipientIds: ["b"] });
		expect(store.get("group:g").attempt).toBeUndefined();
		let fail!: (error: Error) => void;
		const failing = store.send(
			"group:g",
			() =>
				new Promise<void>((_resolve, reject) => {
					fail = reject;
				}),
		);
		store.edit("group:g", { text: "keep after failure", recipientIds: ["c"] });
		fail(Error("transport lost"));
		await failing;
		expect(store.get("group:g").draft).toMatchObject({ text: "keep after failure", recipientIds: ["c"] });
		expect(store.get("group:g").attempt).toMatchObject({ text: "next", recipientIds: ["b"], state: "uncertain" });
	});
	it("persists before dispatch and retries the original immutable request after restart", async () => {
		const disk = storage(),
			store = new ComposerStore(disk);
		store.edit("bot:a", { text: "hello" });
		let id = "";
		await store.send("bot:a", async (a) => {
			id = a.requestId;
			expect(disk.getItem(COMPOSER_STORAGE_KEY)).toContain(id);
			throw Error("lost acknowledgement");
		});
		store.edit("bot:a", { text: "new text" });
		const restored = new ComposerStore(disk);
		expect(restored.get("bot:a").attempt?.state).toBe("uncertain");
		let calls = 0;
		await restored.send("bot:a", async () => {
			calls++;
		});
		expect(calls).toBe(0);
		await restored.send(
			"bot:a",
			async (a) => {
				expect(a.text).toBe("hello");
				expect(a.requestId).toBe(id);
			},
			true,
		);
		expect(restored.get("bot:a").draft.text).toBe("new text");
	});
	it("pending on disk becomes uncertain; success clears only the acknowledged draft", async () => {
		const disk = storage(),
			store = new ComposerStore(disk);
		store.edit("group:g", { text: "work", recipientIds: ["a"] });
		let done!: () => void;
		const pending = store.send(
			"group:g",
			() =>
				new Promise<void>((resolve) => {
					done = resolve;
				}),
		);
		expect(new ComposerStore(disk).get("group:g").attempt?.state).toBe("uncertain");
		done();
		await pending;
		expect(store.get("group:g").draft).toMatchObject({ text: "", recipientIds: [] });
	});
	it("storage failure prevents dispatch and preserves text in memory", async () => {
		const store = new ComposerStore({
			getItem: () => null,
			setItem: () => {
				throw Error("quota");
			},
		});
		store.edit("bot:a", { text: "keep" });
		let called = false;
		expect(
			await store.send("bot:a", async () => {
				called = true;
			}),
		).toBe(false);
		expect(called).toBe(false);
		expect(store.get("bot:a").draft.text).toBe("keep");
		expect(store.warning).toBeDefined();
	});
	it("corrupt data is not overwritten by load; deletion is not undone by a late response", async () => {
		const disk = storage();
		disk.setItem(COMPOSER_STORAGE_KEY, "invalid");
		const store = new ComposerStore(disk);
		expect(store.warning).toBeDefined();
		expect(disk.getItem(COMPOSER_STORAGE_KEY)).toBe("invalid");
		store.edit("bot:a", { text: "hello" });
		let done!: () => void;
		const pending = store.send(
			"bot:a",
			() =>
				new Promise<void>((resolve) => {
					done = resolve;
				}),
		);
		store.remove("bot:a");
		done();
		await pending;
		expect(store.snapshot()["bot:a"]).toBeUndefined();
	});
});

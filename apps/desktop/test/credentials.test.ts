import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { DesktopCredentials, type NativeKeychain } from "../src/main/credentials";
import { CREDENTIAL_LIMITS, type CredentialOperation, type CredentialRequest } from "@openbot/protocol";

const roots: string[] = [];
afterEach(async () => {
	vi.useRealTimers();
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "openbot-credentials-"));
	roots.push(root);
	const values = new Map<string, string>();
	const events: string[] = [];
	const native: NativeKeychain = {
		access: vi.fn(async (operation, service, id, value) => {
			events.push(`${operation}:${service}:${id}`);
			const key = `${service}:${id}`;
			if (operation === "set") {
				values.set(key, value!);
				return null;
			}
			if (operation === "delete") {
				values.delete(key);
				return null;
			}
			return values.get(key) ?? null;
		}),
	};
	const store = new DesktopCredentials(root, "test", native);
	const call = (operation: CredentialOperation, params = {}) =>
		store.handle({ kind: "credential.request", requestId: "test", operation, params } as CredentialRequest);
	const index = (name = "credentials-v2.json") => readFile(join(root, name), "utf8").then(JSON.parse);
	return { root, values, events, native, store, call, index };
}
it("serializes the whole index and never stores secret material in metadata", async () => {
	const f = await fixture();
	const responses = await Promise.all(
		["model", "search:tavily", "connector:notes"].map((id) => f.call("set", { id, value: "SYNTHETIC-secret" })),
	);
	expect(responses.every((r) => r.ok)).toBe(true);
	expect(await f.index()).toEqual(["connector:notes", "model", "search:tavily"]);
	expect((await stat(join(f.root, "credentials-v2.json"))).mode & 0o777).toBe(0o600);
	expect(await f.call("get", { id: "model" })).toMatchObject({ ok: true, result: { value: "SYNTHETIC-secret" } });
	expect(JSON.stringify(await f.call("list"))).not.toContain("SYNTHETIC-secret");
});
it("verifies and durably indexes before deleting legacy data", async () => {
	const f = await fixture();
	await writeFile(join(f.root, "credentials.json"), '["model"]');
	f.values.set("test:model", "old");
	const access = f.native.access;
	f.native.access = async (...args) => {
		if (args[0] === "delete" && args[1] === "test") {
			expect(await f.index()).toEqual(["model"]);
			expect(f.events).toContain("get:test.v2:model");
		}
		return access(...args);
	};
	expect(await f.call("get", { id: "model" })).toMatchObject({ ok: false, code: "migration_required" });
	expect(await f.call("migrate")).toMatchObject({ ok: true, result: { migrated: 1, blocked: 0, cleanupPending: 0 } });
	expect(await f.index("credentials.json")).toEqual([]);
	expect(f.values.has("test:model")).toBe(false);
});
it("never replaces a newer value after interruption between native storage and index commit", async () => {
	const f = await fixture();
	await writeFile(join(f.root, "credentials.json"), '["model"]');
	f.values.set("test:model", "old");
	f.values.set("test.v2:model", "newer");
	expect(await f.call("migrate")).toMatchObject({ ok: true, result: { migrated: 1 } });
	expect(f.values.get("test.v2:model")).toBe("newer");
	expect(f.events).not.toContain("get:test:model");
	expect(f.events).not.toContain("set:test.v2:model");
});
it.each(["legacy-read", "verify", "cleanup"])("keeps retryable indexes when migration is interrupted at %s", async (boundary) => {
	const f = await fixture();
	await writeFile(join(f.root, "credentials.json"), '["model"]');
	f.values.set("test:model", "old");
	const original = f.native.access;
	let written = false;
	f.native.access = async (...args) => {
		if (args[0] === "set") written = true;
		if (
			(boundary === "legacy-read" && args[0] === "get" && args[1] === "test") ||
			(boundary === "verify" && args[0] === "get" && args[1] === "test.v2" && written) ||
			(boundary === "cleanup" && args[0] === "delete")
		)
			throw Error("denied");
		return original(...args);
	};
	expect(await f.call("migrate")).toMatchObject({ ok: true, result: boundary === "cleanup" ? { cleanupPending: 1 } : { blocked: 1 } });
	expect(await f.index("credentials.json")).toEqual(["model"]);
	expect(f.values.get("test:model")).toBe("old");
	f.native.access = original;
	const restarted = new DesktopCredentials(f.root, "test", f.native);
	expect(await restarted.handle({ kind: "credential.request", requestId: "restart", operation: "migrate", params: {} })).toMatchObject({
		ok: true,
		result: { migrated: 1, blocked: 0, cleanupPending: 0 },
	});
});
it("retains the legacy index when replacement saves but cleanup is denied", async () => {
	const f = await fixture();
	await writeFile(join(f.root, "credentials.json"), '["model"]');
	f.values.set("test:model", "old");
	const original = f.native.access;
	f.native.access = async (...args) => {
		if (args[0] === "delete") throw Error("denied");
		return original(...args);
	};
	expect(await f.call("set", { id: "model", value: "new" })).toMatchObject({ ok: false, code: "cleanup_required" });
	expect(await f.index()).toEqual(["model"]);
	expect(await f.index("credentials.json")).toEqual(["model"]);
	expect(await f.call("get", { id: "model" })).toMatchObject({ ok: true, result: { value: "new" } });
});
it("does not claim deletion when a native removal fails, and retries both versions", async () => {
	const f = await fixture();
	await f.call("set", { id: "model", value: "new" });
	const original = f.native.access;
	f.native.access = async (...args) => {
		if (args[0] === "delete") throw Error("denied");
		return original(...args);
	};
	expect(await f.call("delete", { id: "model" })).toMatchObject({ ok: false, code: "denied" });
	expect(await f.index()).toEqual(["model"]);
	f.native.access = original;
	expect(await f.call("delete", { id: "model" })).toMatchObject({ ok: true });
	expect(await f.index()).toEqual([]);
	expect(f.values.size).toBe(0);
});
it.each(["corrupt", "missing", "oversize", "invalid-id"])("fails closed on %s metadata across restart", async (kind) => {
	const f = await fixture();
	await f.call("set", { id: "model", value: "new" });
	f.events.length = 0;
	const path = join(f.root, "credentials-v2.json");
	if (kind === "missing") await rm(path);
	else await writeFile(path, kind === "corrupt" ? "{" : kind === "oversize" ? " ".repeat(33000) : '["../bad"]');
	const restarted = new DesktopCredentials(f.root, "test", f.native);
	expect(
		await restarted.handle({ kind: "credential.request", requestId: "restart", operation: "set", params: { id: "other", value: "new" } }),
	).toMatchObject({ ok: false, code: "metadata_error" });
	expect(await f.call("status")).toMatchObject({ ok: true, result: { availability: "metadata_error" } });
	expect(f.events).toEqual([]);
});
it("caps queued work, expires waiting operations and rejects requests from a stale child", async () => {
	const f = await fixture();
	await f.call("status");
	const gate = Promise.withResolvers<string | null>();
	f.native.access = () => gate.promise;
	const first = f.call("set", { id: "model", value: "new" });
	const pending = Array.from({ length: 7 }, (_, i) => f.call("get", { id: `model${i}` }));
	expect(await f.call("status")).toMatchObject({ ok: false, code: "busy" });
	gate.resolve(null);
	await first;
	await Promise.all(pending);
	expect(
		await f.store.handle(
			{ kind: "credential.request", requestId: "stale", operation: "set", params: { id: "model", value: "new" } },
			() => false,
		),
	).toMatchObject({ ok: false, code: "unconfirmed" });
});
it("rejects excess UTF-8, malformed UTF-16 and caller-selected authority before touching native storage", async () => {
	const f = await fixture();
	for (const params of [
		{ id: "model", value: "中".repeat(6000) },
		{ id: "model", value: "\ud800" },
		{ id: "model", value: "x", service: "other" },
		{ id: "search:other", value: "x" },
	])
		expect(await f.call("set", params)).toMatchObject({ ok: false, code: "invalid_request" });
	expect(f.events).toEqual([]);
});

it("keeps a cleanup-pending count when native deletion commits but index replacement fails", async () => {
	const f = await fixture();
	await writeFile(join(f.root, "credentials.json"), '["model"]');
	f.values.set("test:model", "old");
	const { rename, mkdir } = await import("node:fs/promises");
	const original = f.native.access;
	f.native.access = async (...args) => {
		const result = await original(...args);
		if (args[0] === "delete" && args[1] === "test") {
			await rename(join(f.root, "credentials.json"), join(f.root, "retained-index.json"));
			await mkdir(join(f.root, "credentials.json"));
		}
		return result;
	};
	expect(await f.call("migrate")).toMatchObject({ ok: true, result: { cleanupPending: 1, status: { legacyCount: 1 } } });
	await rm(join(f.root, "credentials.json"), { recursive: true });
	await rename(join(f.root, "retained-index.json"), join(f.root, "credentials.json"));
	f.native.access = original;
	expect(await f.call("migrate")).toMatchObject({ ok: true, result: { migrated: 1, cleanupPending: 0 } });
});

it("expires a queued write before dispatch instead of replaying it after a blocked native operation", async () => {
	const f = await fixture();
	await f.call("set", { id: "model", value: "new" });
	const original = f.native.access;
	const gate = Promise.withResolvers<string | null>();
	const started = Promise.withResolvers<void>();
	f.native.access = () => { started.resolve(); return gate.promise; };
	const first = f.call("get", { id: "model" });
	await started.promise;
	const waiting = f.call("set", { id: "other", value: "new" });
	const now = Date.now();
	vi.spyOn(Date, "now").mockReturnValue(now + CREDENTIAL_LIMITS.timeoutMs + 1);
	gate.resolve("new");
	await first;
	expect(await waiting).toMatchObject({ ok: false, code: "unconfirmed" });
	vi.restoreAllMocks();
	f.native.access = original;
	expect(f.values.has("test.v2:other")).toBe(false);
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { BotRuntime } from "../src/index.ts";
import { scriptedModels } from "../src/testing.ts";
import type { GroupChange, GroupFields } from "@openbot/protocol";
let root: string;
let runtime: BotRuntime;
const fields: GroupFields = { name: "Studio", objective: "Research", memberIds: ["a", "b"], leadBotId: "a" };
const create: GroupChange = { requestId: "create", action: "create", groupId: "group_g", expectedRevision: 0, fields };
const open = () => BotRuntime.open({ databasePath: join(root, "db"), models: scriptedModels().models });
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "openbot-groups-"));
	runtime = await open();
	for (const id of ["a", "b", "c"]) await runtime.createBot({ botId: id, name: id, createdAt: 1 });
});
afterEach(async () => {
	await runtime.close();
	await rm(root, { recursive: true, force: true });
});
it("validates membership, revisions and replay identity atomically", async () => {
	for (const bad of [
		{ ...fields, memberIds: ["a"] },
		{ ...fields, memberIds: ["a", "a"] },
		{ ...fields, leadBotId: "c" },
		{ ...fields, memberIds: ["a", "missing"] },
	])
		await expect(runtime.groups().change({ ...create, fields: bad }, 1)).rejects.toThrow();
	await expect(runtime.groups().change({ ...create, groupId: "direct" }, 1)).rejects.toThrow("Invalid group change");
	const group = await runtime.groups().change(create, 1);
	expect(await runtime.groups().change(create, 2)).toEqual(group);
	await expect(runtime.groups().change({ ...create, fields: { ...fields, name: "Other" } }, 2)).rejects.toThrow("reused");
	const changes = ["one", "two"].map((requestId) =>
		runtime
			.groups()
			.change({ requestId, action: "update", groupId: "group_g", expectedRevision: 1, fields: { ...fields, name: requestId } }, 3),
	);
	expect((await Promise.allSettled(changes)).filter((r) => r.status === "fulfilled")).toHaveLength(1);
	expect((await runtime.groups().get("group_g"))?.revision).toBe(2);
});
it("binds recipients and inputs, deduplicates publication after reopen and retains dissolved history", async () => {
	await runtime.groups().change(create, 1);
	const post = await runtime.groups().post("group_g", "p", "Task", undefined, 2);
	expect(post.recipientIds).toEqual(["a"]);
	expect(await runtime.groups().post("group_g", "p", "Task", undefined, 3)).toEqual(post);
	await expect(runtime.groups().post("group_g", "p", "Changed", undefined, 3)).rejects.toThrow("reused");
	await expect(runtime.groups().post("group_g", "bad", "Task", ["c"], 3)).rejects.toThrow("members");
	const delivery = (await runtime.groups().deliveries())[0]!;
	await runtime.groups().admitted(delivery.deliveryId, "run");
	await runtime.groups().finish(delivery.deliveryId, "completed", "Answer", 4);
	await runtime.close();
	runtime = await open();
	await runtime.groups().finish(delivery.deliveryId, "completed", "Duplicate", 5);
	expect((await runtime.groups().posts("group_g")).map((p) => p.text)).toEqual(["Task", "Answer"]);
	expect((await runtime.groups().posts("group_g"))[1]).toMatchObject({ senderId: "a", replyTo: post.postId, recipientIds: [] });
	await runtime.groups().change({ requestId: "end", action: "dissolve", groupId: "group_g", expectedRevision: 1 }, 6);
	await expect(runtime.groups().post("group_g", "new", "No", undefined, 7)).rejects.toThrow("dissolved");
	expect(await runtime.groups().posts("group_g")).toHaveLength(2);
});
it("removal and re-add never revive deliveries; deleting the lead pauses routing atomically", async () => {
	await runtime.groups().change(create, 1);
	await runtime.groups().post("group_g", "p", "Task", ["b"], 2);
	await runtime
		.groups()
		.change(
			{ requestId: "remove", action: "update", groupId: "group_g", expectedRevision: 1, fields: { ...fields, memberIds: ["a", "c"] } },
			3,
		);
	await runtime.groups().change({ requestId: "add", action: "update", groupId: "group_g", expectedRevision: 2, fields }, 4);
	const d = (await runtime.groups().deliveries())[0]!;
	expect(d.state).toBe("cancelled");
	await runtime.groups().finish(d.deliveryId, "completed", "Late reply", 5);
	expect(await runtime.groups().posts("group_g")).toHaveLength(1);
	await runtime.updateBot("a", { status: "deleted" });
	expect(await runtime.groups().get("group_g")).toMatchObject({ memberIds: ["b"], leadBotId: null, revision: 4 });
	await expect(runtime.groups().post("group_g", "later", "Task", undefined, 6)).rejects.toThrow("lead");
});

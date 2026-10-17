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
	await runtime.ensureCoreBot(1);
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
	const post = await runtime.groups().post("group_g", "p", "Task", ["a"], 2);
	expect(post.recipientIds).toEqual(["a"]);
	expect(await runtime.groups().post("group_g", "p", "Task", ["a"], 3)).toEqual(post);
	await expect(runtime.groups().post("group_g", "p", "Changed", ["a"], 3)).rejects.toThrow("reused");
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
	await expect(runtime.groups().post("group_g", "later", "Task", ["a"], 6)).rejects.toThrow("lead");
});

it("routes ordinary posts to Core independent of lead and does not grant dispatch by mentioning a name", async () => {
	await runtime.groups().change(create, 1);
	const core = (await runtime.listBots()).find((b) => b.kind === "core")!;
	const post = await runtime.groups().post("group_g", "plain", "@b please work", undefined, 2);
	expect(post.recipientIds).toEqual([core.botId]);
	expect(await runtime.groups().deliveries()).toHaveLength(1);
	expect((await runtime.groups().deliveries())[0]?.input).toContain('"botId":"b"');
});

const startTask = async (requestId = "task") => {
	if (!(await runtime.groups().get("group_g"))) await runtime.groups().change(create, 1);
	await runtime.groups().post("group_g", requestId, "Do the work", ["a"], 2);
	return (await runtime.groups().deliveries()).find(
		(d) => d.origin === "user" && d.input.includes("Do the work") && d.deliveryId.includes(requestId),
	)!;
};
it("commits dispatch, ownership and receipt once across reopen; rejects changed replay and dispatch after transfer", async () => {
	const d = await startTask();
	const receipt = await runtime.groups().dispatch("call", "hash", d.deliveryId, "b", "Review", "Findings", true, 3);
	await runtime.close();
	runtime = await open();
	expect(await runtime.groups().dispatch("call", "hash", d.deliveryId, "b", "Review", "Findings", true, 4)).toEqual(receipt);
	await expect(runtime.groups().dispatch("call", "changed", d.deliveryId, "b", "Other", "Findings", true, 4)).rejects.toThrow("changed");
	await expect(runtime.groups().dispatch("next", "hash", d.deliveryId, "b", "Other", "Findings", false, 4)).rejects.toThrow("authority");
	expect(await runtime.groups().deliveries()).toHaveLength(2);
	await runtime.groups().finish(d.deliveryId, "completed", "Transferred", 5);
	await runtime.groups().finish(receipt.deliveryId!, "completed", "Reviewed", 6);
	await runtime.groups().reconcile(7);
	await runtime.groups().reconcile(8);
	expect(await runtime.groups().deliveries()).toHaveLength(2);
	expect((await runtime.groups().roots("group_g"))[0]?.state).toBe("completed");
});
it("joins delegated results once without waking peers for normal replies", async () => {
	const d = await startTask();
	const child = await runtime.groups().dispatch("call", "hash", d.deliveryId, "b", "Review", "Findings", false, 3);
	await runtime.groups().finish(d.deliveryId, "completed", "Assigned", 4);
	await runtime.groups().reconcile(5);
	expect(await runtime.groups().deliveries()).toHaveLength(2);
	await runtime.groups().finish(child.deliveryId!, "completed", "Evidence 42", 6);
	await runtime.groups().reconcile(7);
	await runtime.groups().reconcile(8);
	const continuation = (await runtime.groups().deliveries()).find((d) => d.origin === "result")!;
	expect(continuation.input).toContain("Evidence 42");
	expect(continuation.botId).toBe("a");
	await runtime.groups().finish(continuation.deliveryId, "completed", "Final answer", 9);
	for (let i = 0; i < 3; i++) await runtime.groups().reconcile(10 + i);
	expect(await runtime.groups().deliveries()).toHaveLength(3);
	expect((await runtime.groups().roots("group_g"))[0]).toMatchObject({ state: "completed", automaticDeliveries: 2 });
});
it("pauses ancestor cycles durably and leaves an unrelated root running", async () => {
	const first = await startTask("first");
	const second = await startTask("second");
	const child = await runtime.groups().dispatch("call", "hash", first.deliveryId, "b", "Review", "Findings", false, 3);
	const rejected = await runtime.groups().dispatch("cycle", "hash", child.deliveryId!, "a", "Please acknowledge", "Thanks", false, 4);
	expect(rejected.error).toContain("ancestor");
	await runtime.close();
	runtime = await open();
	expect((await runtime.groups().roots("group_g")).find((r) => r.rootId === first.rootId)?.state).toBe("paused");
	expect((await runtime.groups().deliveries()).find((d) => d.deliveryId === second.deliveryId)?.state).toBe("pending");
	await runtime.groups().reconcile(5);
	expect((await runtime.groups().deliveries()).filter((d) => d.rootId === first.rootId).every((d) => d.state === "cancelled")).toBe(true);
});
it("enforces hop and delivery budgets including result continuations", async () => {
	await runtime.groups().change({ ...create, fields: { ...fields, memberIds: ["a", "b", "c"] } }, 1);
	const d = await startTask();
	const one = await runtime.groups().dispatch("one", "one", d.deliveryId, "b", "Task", "Result", false, 3);
	const two = await runtime.groups().dispatch("two", "two", one.deliveryId!, "c", "Task", "Result", false, 4);
	const core = (await runtime.listBots()).find((b) => b.kind === "core")!;
	expect((await runtime.groups().dispatch("three", "three", two.deliveryId!, core.botId, "Task", "Result", false, 5)).error).toContain(
		"hop",
	);
	const other = await startTask("budget");
	for (let i = 0; i < 12; i++)
		await runtime.groups().dispatch(`call${i}`, `hash${i}`, other.deliveryId, "b", "Task", "Result", false, 6 + i);
	expect((await runtime.groups().dispatch("overflow", "overflow", other.deliveryId, "b", "Task", "Result", false, 20)).error).toContain(
		"delivery limit",
	);
	expect((await runtime.groups().roots("group_g")).find((r) => r.rootId === other.rootId)).toMatchObject({
		automaticDeliveries: 12,
		state: "paused",
	});
});
it("rejects out-of-scope recipients and cancellation invalidates descendants before admission", async () => {
	const d = await startTask();
	await expect(runtime.groups().dispatch("outside", "hash", d.deliveryId, "c", "Task", "Result", false, 3)).rejects.toThrow("outside");
	const child = await runtime.groups().dispatch("child", "hash", d.deliveryId, "b", "Task", "Result", false, 3);
	await runtime.groups().stop(d.rootId!);
	expect((await runtime.groups().deliveries()).find((d) => d.deliveryId === child.deliveryId)?.state).toBe("cancelled");
	await runtime.groups().finish(child.deliveryId!, "completed", "Late", 4);
	expect((await runtime.groups().posts("group_g")).some((p) => p.text === "Late")).toBe(false);
});

it("charges result continuations against the root budget and never silently resets it", async () => {
	const d = await startTask();
	const children = [];
	for (let i = 0; i < 11; i++)
		children.push(await runtime.groups().dispatch(`c${i}`, `f${i}`, d.deliveryId, "b", `Check ${i}`, "Result", false, 3 + i));
	await runtime.groups().finish(d.deliveryId, "completed", "Assigned", 20);
	for (const child of children) await runtime.groups().finish(child.deliveryId!, "completed", "Done", 21);
	await runtime.groups().reconcile(22);
	await runtime.groups().reconcile(23);
	const continuation = (await runtime.groups().deliveries()).find((d) => d.origin === "result")!;
	expect((await runtime.groups().roots("group_g"))[0]?.automaticDeliveries).toBe(12);
	expect((await runtime.groups().dispatch("extra", "extra", continuation.deliveryId, "b", "Again", "Result", false, 24)).error).toContain(
		"delivery limit",
	);
	expect((await runtime.groups().roots("group_g"))[0]?.state).toBe("paused");
});
it("member removal cancels its delegated descendants without leaving an orphan root", async () => {
	const d = await startTask();
	const child = await runtime.groups().dispatch("child", "hash", d.deliveryId, "b", "Task", "Result", false, 3);
	await runtime.groups().finish(d.deliveryId, "completed", "Assigned", 4);
	await runtime
		.groups()
		.change(
			{
				requestId: "remove-owner",
				action: "update",
				groupId: "group_g",
				expectedRevision: 1,
				fields: { ...fields, memberIds: ["b", "c"], leadBotId: "b" },
			},
			5,
		);
	await runtime.groups().reconcile(6);
	expect((await runtime.groups().deliveries()).find((d) => d.deliveryId === child.deliveryId)?.state).toBe("cancelled");
	expect((await runtime.groups().roots("group_g"))[0]?.state).toBe("completed");
	await runtime.groups().change({ requestId: "restore-owner", action: "update", groupId: "group_g", expectedRevision: 2, fields }, 7);
	await runtime.groups().reconcile(8);
	expect((await runtime.groups().deliveries()).some((d) => d.state === "pending")).toBe(false);
});

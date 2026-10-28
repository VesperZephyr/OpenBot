import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";
import { Harness, createRegistry } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { HistoryProjection } from "../src/history-projection.ts";
import { seedHistory } from "./history-fixture.ts";
import { scriptedModels } from "../src/testing.ts";

it("builds bounded public windows and reopens checked source checkpoints", async () => {
	const root = await mkdtemp(join(tmpdir(), "openbot-history-projection-")),
		databasePath = join(root, "openbot.sqlite");
	await seedHistory(databasePath, 1000, 0);
	const harness = await Harness.open(
		await openNodeSqliteStorage(databasePath),
		{ models: scriptedModels().models, registry: createRegistry() },
		BACKGROUND_CONTEXT,
	);
	const options = { path: join(root, "cache", "history.sqlite"), databasePath, channels: async () => [], changed: () => {} };
	let projection = new HistoryProjection(harness, BACKGROUND_CONTEXT, options);
	try {
		const ready = async () => {
			for (let i = 0; i < 1000 && projection.status().state === "building"; i++) await delay(10);
			expect(projection.status().state).toBe("ready");
		};
		await ready();
		const latest = await projection.window({ conversationKey: "bot:history_0", position: { kind: "latest" } });
		expect(latest.status).toBe("ready");
		if (latest.status !== "ready") throw Error("Not ready");
		expect(latest.window.rows).toHaveLength(100);
		expect(latest.window.readCursor).toBe(1000);
		expect(latest.window.before).toBeDefined();
		const group = await projection.window({
			conversationKey: "group:group_history",
			position: { kind: "around", rowId: "post_5" },
			limit: 10,
		});
		expect(group.status === "ready" && group.window.rows.map((r) => r.id)).toContain("post_5");
		expect((await projection.search("星图", ["bot:history_0", "group:group_history"], "owner")).items).toHaveLength(30);
		await projection.close();
		projection = new HistoryProjection(harness, BACKGROUND_CONTEXT, options);
		await ready();
		const reopened = await projection.window({ conversationKey: "bot:history_0", position: { kind: "latest" } });
		expect(reopened).toEqual(latest);
	} finally {
		await projection.close();
		await harness.close(BACKGROUND_CONTEXT);
		await rm(root, { recursive: true, force: true });
	}
}, 30000);

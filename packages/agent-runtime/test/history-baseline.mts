import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, cpus, totalmem } from "node:os";
import { seedHistory } from "./history-fixture.ts";
import { BotRuntime } from "../src/index.ts";
import { ConversationSearchIndex } from "../src/conversation-search.ts";
import { directMessages, groupMessages } from "../src/conversation-index.ts";
import { scriptedModels } from "../src/testing.ts";
const root = await mkdtemp(join(tmpdir(), "openbot-history-baseline-"));
let runtime: BotRuntime | undefined;
try {
	const databasePath = join(root, "openbot.sqlite");
	const started = performance.now();
	await seedHistory(databasePath);
	const seeded = performance.now();
	runtime = await BotRuntime.open({ databasePath, models: scriptedModels().models, history: false });
	const opened = performance.now();
	const snapshot = await runtime.snapshot("history_0");
	const read = performance.now();
	const group = await runtime.groups().history("group_history");
	const groupRead = performance.now();
	const oracle = new ConversationSearchIndex();
	oracle.project("bot:history_0", directMessages(snapshot));
	oracle.project("group:group_history", groupMessages(group.posts));
	const searches = [];
	for (let i = 0; i < 35; i++) {
		const at = performance.now();
		oracle.search("absent literal", new Set(["bot:history_0", "group:group_history"]), "baseline");
		if (i >= 5) searches.push(performance.now() - at);
	}
	searches.sort((a, b) => a - b);
	console.log(
		JSON.stringify(
			{
				node: process.version,
				cpu: cpus()[0]?.model,
				memory: totalmem(),
				seedMs: seeded - started,
				openMs: opened - seeded,
				directSnapshotMs: read - opened,
				groupSnapshotMs: groupRead - read,
				directItems: snapshot.items.length,
				groupPosts: group.posts.length,
				directBytes: Buffer.byteLength(JSON.stringify(snapshot)),
				groupBytes: Buffer.byteLength(JSON.stringify(group)),
				searchP95: searches[28],
				rss: process.memoryUsage().rss,
			},
			null,
			2,
		),
	);
} finally {
	await runtime?.close();
	await rm(root, { recursive: true, force: true });
}

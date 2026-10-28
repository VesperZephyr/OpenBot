/** Deterministic retained history. Uses the Pi adapter's public transaction API, never raw database writes. */
import { Harness, createRegistry, type ConversationId } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { BotsDoc } from "../src/bots.ts";
import { GroupsDoc } from "../src/groups.ts";
import { BotRuntime } from "../src/index.ts";
import { scriptedModels } from "../src/testing.ts";

export function historyText(i: number): string {
	return `Record ${i}: ${i % 17 === 0 ? "NEEDLE 星图" : "archive"} — Cafe\u0301, café, Kelvin K, emoji 🦊.\n\n${"Synthetic retained evidence. ".repeat(8)}`;
}
export async function seedHistory(databasePath: string, count = 10000, otherCount = 28): Promise<void> {
	const runtime = await BotRuntime.open({ databasePath, models: scriptedModels().models });
	for (let i = 0; i <= otherCount; i++) await runtime.createBot({ botId: `history_${i}`, name: `History ${i}`, createdAt: 1 });
	await runtime.close();
	const harness = await Harness.open(
		await openNodeSqliteStorage(databasePath),
		{ models: scriptedModels().models, registry: createRegistry() },
		BACKGROUND_CONTEXT,
	);
	try {
		const bots = (await harness.snapshot(BotsDoc, BACKGROUND_CONTEXT))!.bots;
		for (const [j, bot] of Object.values(bots).entries()) {
			const length = j === 0 ? count : 1000;
			for (let start = 0; start < length; start += 128)
				await harness.commit(async (tx) => {
					for (let i = start; i < Math.min(start + 128, length); i++) {
						await tx.appendEntry(bot.conversationId as ConversationId, {
							kind: "pi.assistant",
							model: [{ ...fauxAssistantMessage(historyText(i)), timestamp: Math.floor(i / 4) }],
						});
						if (j === 0 && i > 0 && i % 500 === 0)
							await tx.appendEntry(bot.conversationId as ConversationId, { kind: "pi.reset", head: "self" });
					}
				}, BACKGROUND_CONTEXT);
		}
		await harness.commit(async (tx) => {
			const groups = await tx.doc(GroupsDoc);
			groups.groups.group_history = {
				groupId: "group_history",
				name: "History group",
				objective: "Fixture",
				memberIds: ["history_0", "history_1"],
				leadBotId: "history_0",
				revision: 1,
				status: "active",
				createdAt: 1,
			};
			groups.posts.group_history = Array.from({ length: count }, (_, i) => ({
				postId: `post_${i}`,
				senderId: i % 2 ? "history_0" : "user",
				text: historyText(i),
				at: Math.floor(i / 4),
				recipientIds: [],
			}));
		}, BACKGROUND_CONTEXT);
	} finally {
		await harness.close(BACKGROUND_CONTEXT);
	}
}

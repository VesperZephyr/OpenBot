import { AgentDoc, type Tx, type ConversationRecord } from "@earendil-works/pi-durable";
import { MEMORY_READ_NAMES } from "@openbot/protocol";
import { BotsDoc } from "./bots.ts";
import { ChannelsDoc } from "./channels.ts";
import { MemoryDoc, SharedMemoryDoc, memoryState } from "./memory.ts";
import { selectiveMemory } from "./memory-retrieval.ts";

export async function syncMemoryTools(tx: Tx): Promise<void> {
	const bots = (await tx.doc(BotsDoc)).bots, channels = (await tx.doc(ChannelsDoc)).channels;
	const shared = memoryState(await tx.doc(SharedMemoryDoc));
	for (const bot of Object.values(bots)) {
		if (bot.status === "deleted") continue;
		const local = memoryState(await tx.doc(MemoryDoc, bot.botId, null));
		const contexts = [{ conversationId: bot.conversationId, group: false }, ...Object.values(channels).filter(c => c.botId === bot.botId).map(c => ({ conversationId: c.conversationId, group: c.kind === "group" }))];
		for (const c of contexts) {
			const offered = selectiveMemory(local, c.group ? undefined : shared);
			const agent = await tx.doc(AgentDoc, c.conversationId as ConversationRecord["id"]);
			const filter = agent.modelTools;
			if (Array.isArray(filter)) {
				agent.modelTools = [...filter.filter(name => !MEMORY_READ_NAMES.some(n => n === name)), ...(offered ? MEMORY_READ_NAMES : [])];
			} else {
				const remove = [...(filter?.remove ?? []).filter(name => !MEMORY_READ_NAMES.some(n => n === name)), ...(offered ? [] : MEMORY_READ_NAMES)];
				agent.modelTools = { ...filter, remove };
			}
		}
	}
}

import { defineDoc } from "@earendil-works/pi-durable";
export const ChannelsDoc = defineDoc<{ channels: Record<string, { botId: string; channelId: string; conversationId: number }> }>({
	kind: "openbot.channels",
	version: 1,
	scope: "session",
	initial: () => ({ channels: {} }),
});

import { defineDoc } from "@earendil-works/pi-durable";
export type ChannelRecord = { botId: string; channelId: string; conversationId: number; kind: "group" | "routine" | "task"; taskId?: string };
export const ChannelsDoc = defineDoc<{ channels: Record<string, ChannelRecord> }>({
 kind: "openbot.channels", version: 2, scope: "session",
 initial: () => ({ channels: {} }),
 migrate(value, version) {
  if(version!==1)throw new Error("Unsupported channel version");
  const old=value as {channels:Record<string,Omit<ChannelRecord,"kind">>};
  return {channels:Object.fromEntries(Object.entries(old.channels).map(([key,c])=>[key,{...c,kind:c.channelId.startsWith("routine_")?"routine" as const:"group" as const}]))};
 },
});
export function channelKind(channel:ChannelRecord):ChannelRecord["kind"] {
 if(!["group","routine","task"].includes(channel.kind) || (channel.kind==="task" && !channel.taskId))throw new Error("Invalid channel context");
 return channel.kind;
}

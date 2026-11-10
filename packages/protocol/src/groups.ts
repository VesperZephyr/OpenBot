import type { ArtifactRef } from "./artifacts.ts";
import type { ConversationSnapshot } from "./conversations.ts";

export type GroupFields = {
	readonly name: string;
	readonly objective: string;
	readonly memberIds: readonly string[];
	readonly leadBotId: string;
};
export type Group = Omit<GroupFields, "leadBotId"> & {
	readonly leadBotId: string | null;
	readonly groupId: string;
	readonly revision: number;
	/** Destination authority; name-only edits preserve this version. */
	readonly deliveryRevision?: number;
	readonly status: "active" | "dissolved";
	readonly createdAt: number;
};
export type GroupChange = {
	readonly requestId: string;
	readonly action: "create" | "update" | "dissolve";
	readonly groupId: string;
	readonly expectedRevision: number;
	readonly fields?: GroupFields;
};
export type CollaborationRoot = {
	readonly rootId: string;
	readonly groupId: string;
	readonly coreBotId: string;
	readonly postId: string;
	readonly allowedBotIds: readonly string[];
	readonly initialIds: readonly string[];
	readonly automaticDeliveries: number;
	readonly state: "running" | "completed" | "paused" | "cancelled";
	readonly reason?: string;
};
export type CollaborationSnapshot = {
	readonly roots: readonly (CollaborationRoot & { readonly subject?: string })[];
	readonly posts: readonly GroupPost[];
	readonly tasks: readonly (GroupDelivery & { readonly conversation?: ConversationSnapshot })[];
};
export type GroupPost = {
	readonly routine?: import("./routines.ts").RoutineReport;
	readonly attachments?: readonly ArtifactRef[];
	readonly rootId?: string;
	readonly kind?: "delegation" | "handoff" | "result" | "update";
	readonly update?: { readonly runId: string; readonly botId: string; readonly conversationId: string; readonly callId: string; readonly targetId: string; readonly deliveryId: string };

	readonly postId: string;
	readonly senderId: string;
	readonly text: string;
	readonly at: number;
	readonly recipientIds: readonly string[];
	readonly replyTo?: string;
};
export type GroupDelivery = {
	readonly rootId?: string;
	readonly parentId?: string;
	readonly origin?: "user" | "peer" | "result" | "background";
	readonly backgroundSourceId?: string;
	readonly backgroundReady?: boolean;
	readonly depth?: number;
	readonly ancestry?: readonly string[];
	readonly expectedResult?: string;
	readonly transferId?: string;
	readonly continuationId?: string;
	readonly closed?: boolean;

	readonly deliveryId: string;
	readonly groupId: string;
	readonly postId: string;
	readonly botId: string;
	readonly input: string;
	readonly state: "pending" | "completed" | "failed" | "cancelled";
	readonly runId?: string;
};
export type GroupSnapshot = CollaborationSnapshot & { readonly backgroundTasks?:readonly import("./background.ts").BackgroundRecord[]; readonly group: Group; readonly readCursor?: number };

import type { AppReadAuthority } from "./app-capabilities.ts";
export const APP_CODE_VERSION = 2;
export const APP_CODE_LIMITS = {
	sourceBytes: 32768,
	heapBytes: 64 * 1024 * 1024,
	deadlineMs: 60000,
	calls: 64,
	bridgeCalls: 128,
	pending: 8,
	outputBytes: 65536,
	outputTokens: 2000,
	maxOutputTokens: 4000,
} as const;
export type AppMutationBinding = { executionId: string; callId: string; digest: string };
export type AppExecution = {
	managementClosed?: boolean;
	executionId: string;
	parentCallId: string;
	botId: string;
	conversationId: string;
	authority: AppReadAuthority;
	targetId: string;
	version: number;
	catalogDigest: string;
	sourceDigest: string;
	limits: {
		sourceBytes: number;
		heapBytes: number;
		deadlineMs: number;
		calls: number;
		bridgeCalls: number;
		pending: number;
		outputBytes: number;
		outputTokens: number;
		maxOutputTokens: number;
	};
	admittedAt: number;
	deadline: number;
	state: "admitted" | "running" | "succeeded" | "failed" | "cancelled" | "needs_attention";
	children: {
		callId: string;
		capability: string;
		digest: string;
		state: "running" | "succeeded" | "failed" | "cancelled";
		outcome?: "denied" | "expired" | "unknown";
		receiptId?: string;
		object?: { kind: "bot" | "group"; id: string; revision: number };
	}[];
	endedAt?: number;
	error?: string;
};
export const CODEMODE_DEFINITION = {
	name: "codemode",
	capability: "app.orchestrate" as const,
	destination: "host" as const,
	description: "Compose authorized local application operations.",
	parameters: {
		type: "object",
		properties: { code: { type: "string", minLength: 1, maxLength: 32768 } },
		required: ["code"],
		additionalProperties: false,
	},
};

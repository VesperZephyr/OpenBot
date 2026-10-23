import type { ArtifactRef, ConversationSnapshot, SkillRef } from "./index.ts";
export const ROUTINE_LIMITS = { perBot: 50, active: 500, identities: 1024, receipts: 4096, history: 20, text: 16384 } as const;
export type RoutineSchedule =
	| { readonly kind: "interval"; readonly minutes: number }
	| { readonly kind: "daily"; readonly time: string; readonly timezone: string }
	| { readonly kind: "weekly"; readonly time: string; readonly timezone: string; readonly weekday: number };
export type RoutineFields = {
	readonly reportTo?: { readonly groupId: string; readonly groupRevision: number };
	readonly name: string;
	readonly instructions: string;
	readonly schedule: RoutineSchedule;
	readonly catchUpHours: number;
	readonly skills: readonly SkillRef[];
};
export type Routine = RoutineFields & {
	readonly destinationBlocked?: boolean;
	readonly routineId: string;
	readonly botId: string;
	readonly targetId: string;
	readonly revision: number;
	readonly enabled: boolean;
	readonly deleted: boolean;
	readonly createdAt: number;
	readonly anchor: number;
	readonly nextAt: number;
};
export type RoutineOccurrence = {
	readonly reportTo?: NonNullable<RoutineFields["reportTo"]>;
	readonly destinationBlocked?: boolean;
	readonly occurrenceId: string;
	readonly routineId: string;
	readonly botId: string;
	readonly revision: number;
	readonly channelId: string;
	readonly name: string;
	readonly scheduledAt: number;
	readonly createdAt: number;
	readonly test: boolean;
	readonly instructions: string;
	readonly skills: readonly SkillRef[];
	readonly state: "pending" | "running" | "completed" | "failed" | "cancelled" | "needs_attention" | "skipped";
	readonly runId?: string;
	readonly endedAt?: number;
	readonly stopped?: boolean;
	readonly reason?: string;
	readonly report?: string;
	readonly artifacts?: readonly ArtifactRef[];
	readonly published?: boolean;
	readonly skippedFrom?: number;
};
export type RoutineList = {
	readonly routines: readonly Routine[];
	readonly absenceDays: number;
	readonly lastActiveAt: number;
	readonly absencePaused: boolean;
};
export type RoutineDetail = {
	readonly routine: Routine;
	readonly history: readonly RoutineOccurrence[];
	readonly snapshot?: ConversationSnapshot;
};
export type RoutineChange =
	| { readonly action: "create"; readonly requestId: string; readonly botId: string; readonly fields: RoutineFields }
	| {
			readonly action: "update";
			readonly requestId: string;
			readonly routineId: string;
			readonly expectedRevision: number;
			readonly fields: RoutineFields;
	  }
	| {
			readonly action: "pause" | "resume" | "delete";
			readonly requestId: string;
			readonly routineId: string;
			readonly expectedRevision: number;
	  };
export type RoutineReport = Pick<RoutineOccurrence, "occurrenceId" | "routineId" | "name" | "scheduledAt" | "test" | "state">;

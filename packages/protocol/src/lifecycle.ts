/** Host-owned control state; native observations can only arrive from Desktop main. */
export type LifecycleReason = "user" | "locked" | "suspended" | "quitting" | "recovery";
export type NativeLifecycle = {
	readonly sourceId: string;
	readonly seq: number;
	readonly locked: boolean;
	readonly suspended: boolean;
	readonly quitting: boolean;
};
export type LifecycleRecord = {
	readonly revision: number;
	readonly userPaused: boolean;
	readonly needsResume: boolean;
	readonly lastReason?: LifecycleReason;
};
export type LifecycleState = LifecycleRecord & {
	readonly targetId: string;
	readonly blocked: boolean;
	readonly transitioning: boolean;
	readonly nativeReady: boolean;
	readonly locked: boolean;
	readonly suspended: boolean;
	readonly quitting: boolean;
	readonly error?: string;
};

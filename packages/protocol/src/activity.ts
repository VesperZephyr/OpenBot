export type ActivityLabel =
	| "preparing"
	| "generating"
	| "reading_files"
	| "writing_files"
	| "running_command"
	| "searching_web"
	| "reading_web"
	| "using_connector"
	| "working_application"
	| "sending_update"
	| "waiting_result";
export type ExecutionObservation = {
	readonly runId: string;
	readonly conversationId: string;
	readonly executionKey: string;
	readonly phase: "preparing" | "generating" | "dispatching" | "waiting_result" | "settled";
	readonly family?: ActivityLabel;
	readonly taskId?: string;
	readonly consumedInputId?: string;
};

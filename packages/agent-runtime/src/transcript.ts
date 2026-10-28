import type { EntryRecord } from "@earendil-works/pi-durable";
import type { ToolCall } from "@earendil-works/pi-ai";
import type { MessagePart, TranscriptItem, ToolCallStatus, ArtifactRef } from "@openbot/protocol";
const STOPPED_ENTRY = "openbot.stopped";
/** Text blocks of a user or assistant message; images are not projected yet. */
export function partsOf(content: string | readonly { readonly type: string }[]): MessagePart[] {
	if (typeof content === "string") return content === "" ? [] : [{ type: "text", text: content }];
	return content.flatMap((block) =>
		block.type === "text" && "text" in block && typeof block.text === "string" ? [{ type: "text" as const, text: block.text }] : [],
	);
}

export function textParts(entry: EntryRecord): MessagePart[] {
	return (entry.model ?? []).flatMap((message) =>
		message.role === "user" || message.role === "assistant" ? partsOf(message.content) : [],
	);
}

function toolCallsOf(entry: EntryRecord): ToolCall[] {
	const message = entry.model?.[0];
	if (message?.role !== "assistant") return [];
	return message.content.filter((block): block is ToolCall => block.type === "toolCall");
}

/** Visible reasoning of an assistant entry; redacted blocks carry only an opaque payload and are left out. */
function thinkingOf(entry: EntryRecord): string | undefined {
	const message = entry.model?.[0];
	if (message?.role !== "assistant") return undefined;
	const text = message.content
		.flatMap((block) =>
			block.type === "thinking" && block.redacted !== true && block.thinking.trim() !== "" ? [block.thinking.trim()] : [],
		)
		.join("\n\n");
	return text === "" ? undefined : text;
}

export type MutableToolItem = {
	kind: "tool";
	id: string;
	tool: string;
	args: unknown;
	status: ToolCallStatus;
	failureReason?: import("@openbot/protocol").ToolFailureReason;
	output?: string;
	taskId?: string;
	artifact?: import("@openbot/protocol").ArtifactRef;
};

/** What the model receives for an `unknown` outcome, instead of the executor's text (Section 5.1). */
export const UNKNOWN_OUTCOME_TEXT = "This action was interrupted and may have partly run. Check its effect before doing anything else.";

/** When the entry's first user or assistant message was created; Pi stamps every message. */
function timestampOf(entry: EntryRecord): number | undefined {
	const message = entry.model?.[0];
	return message?.role === "user" || message?.role === "assistant" ? message.timestamp : undefined;
}

/**
 * Transcript items in order. A tool call becomes a `tool` item right after the assistant text that made it; its
 * `pi.tool-result` entry completes that item instead of adding one.
 */
export function toTranscript(entries: readonly EntryRecord[], seeds: readonly TranscriptItem[] = []): TranscriptItem[] {
	const items: TranscriptItem[] = seeds.map((item) => structuredClone(item));
	const tools = new Map<string, MutableToolItem>(
		items.flatMap((item) => (item.kind === "tool" ? [[item.id, item as MutableToolItem]] : [])),
	);
	for (const entry of entries) {
		const id = String(entry.id);
		switch (entry.kind) {
			case "openbot.routine-report": {
				const data = entry.data as unknown as import("@openbot/protocol").RoutineOccurrence;
				items.push({
					kind: "assistant",
					id,
					parts: [{ type: "text", text: data.report ?? data.reason ?? "Routine finished without a report" }],
					at: data.endedAt ?? data.createdAt,
					routine: {
						occurrenceId: data.occurrenceId,
						routineId: data.routineId,
						name: data.name,
						scheduledAt: data.scheduledAt,
						test: data.test,
						state: data.state,
					},
					...(data.artifacts?.length ? { artifacts: data.artifacts } : {}),
				});
				break;
			}
			case "openbot.user-input": {
				const data = entry.data as {
					text: string;
					source?: "background" | "routine";
					attachments: ArtifactRef[];
					skills?: import("@openbot/protocol").SkillRef[];
					error?: string;
					at?: number;
				};
				const at = timestampOf(entry) ?? data.at;
				items.push({
					kind: "user",
					id,
					parts: [{ type: "text", text: data.text }],
					attachments: data.attachments,
					...(data.source ? { source: data.source } : {}),
					...(data.skills ? { skills: data.skills } : {}),
					...(data.error ? { error: data.error } : {}),
					...(at === undefined ? {} : { at }),
				});
				break;
			}
			case "pi.user": {
				const at = timestampOf(entry);
				items.push({ kind: "user", id, parts: textParts(entry), ...(at === undefined ? {} : { at }) });
				break;
			}
			case "pi.assistant": {
				const message = entry.model?.[0];
				const error =
					message?.role === "assistant" && (message.stopReason === "error" || message.stopReason === "aborted")
						? (message.errorMessage ?? message.stopReason)
						: undefined;
				const parts = textParts(entry);
				const thinking = thinkingOf(entry);
				const at = timestampOf(entry);
				if (parts.length > 0 || error !== undefined || thinking !== undefined) {
					items.push({
						kind: "assistant",
						id,
						parts,
						...(thinking === undefined ? {} : { thinking }),
						...(error === undefined ? {} : { error }),
						...(at === undefined ? {} : { at }),
					});
				}
				for (const call of toolCallsOf(entry)) {
					const item: MutableToolItem = { kind: "tool", id: call.id, tool: call.name, args: call.arguments, status: "pending" };
					tools.set(call.id, item);
					items.push(item);
				}
				break;
			}
			case "pi.tool-result": {
				const message = entry.model?.[0];
				if (message?.role !== "toolResult") break;
				const item = tools.get(message.toolCallId);
				if (item === undefined) break;
				// Interrupted: the executor reported `unknown`, or Pi itself settled the call as interrupted by a restart.
				// Cancelled: the user stopped the Run and Pi recorded the call as aborted.
				const diagnostics = (entry.data as { diagnostics?: readonly { code?: string }[] } | undefined)?.diagnostics ?? [];
				const unknown =
					(message.details as { status?: string } | undefined)?.status === "unknown" ||
					diagnostics.some((diagnostic) => diagnostic.code === "interrupted");
				item.status = unknown ? "interrupted" : !message.isError ? "succeeded" : wasAborted(entry) ? "cancelled" : "failed";
				item.output = partsOf(message.content)
					.map((part) => part.text)
					.join("\n");
				const details: unknown = message.details;
				if (
					typeof details === "object" &&
					details !== null &&
					"artifact" in details &&
					details.artifact &&
					typeof details.artifact === "object"
				)
					item.artifact = details.artifact as import("@openbot/protocol").ArtifactRef;
				if (
					details &&
					typeof details === "object" &&
					"failureReason" in details &&
					["approval_expired", "permission_revoked", "approval_denied"].includes(String(details.failureReason))
				)
					item.failureReason = details.failureReason as import("@openbot/protocol").ToolFailureReason;
				if (typeof details === "object" && details !== null && "taskId" in details && typeof details.taskId === "string") {
					item.taskId = details.taskId;
				}
				break;
			}
			case "pi.compaction":
				items.push({ kind: "divider", id, reason: "compaction" });
				break;
			case STOPPED_ENTRY:
				items.push({ kind: "stopped", id });
				break;
			case "pi.reset":
				items.push({ kind: "divider", id, reason: "reset" });
				break;
			case "pi.system":
				break;
			default:
				items.push({ kind: "other", id, entryKind: entry.kind });
		}
	}
	return items;
}

/** Pi marks a tool result it wrote because the run was aborted with an `aborted` diagnostic. */
function wasAborted(entry: EntryRecord): boolean {
	const data = entry.data as { readonly diagnostics?: readonly { readonly code?: string }[] } | undefined;
	return data?.diagnostics?.some((diagnostic) => diagnostic.code === "aborted") === true;
}

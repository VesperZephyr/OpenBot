import type { ToolCallStatus, TranscriptItem } from "@openbot/protocol";
type ToolItem = Extract<TranscriptItem, { kind: "tool" }>;
import { describe, expect, it } from "vitest";
import { elapsedSeconds, formatStepSummary, summarizeSteps, transcriptRows } from "../src/renderer/src/steps";

const tool = (id: string, status: ToolCallStatus = "succeeded", name = "local_read"): ToolItem => ({ kind: "tool", id, tool: name, args: {}, status });
const text = (id: string): TranscriptItem => ({ kind: "assistant", id, parts: [{ type: "text", text: id }] });
const shape = (items: readonly TranscriptItem[], waiting: readonly string[] = []) =>
	transcriptRows(items, new Set(waiting)).map((row) => (row.kind === "steps" ? `steps:${row.items.map((item) => item.id).join(",")}` : row.item.id));

describe("transcriptRows", () => {
	it("folds two or more consecutive successful calls, keeping the first call's ID", () => {
		expect(shape([text("a"), tool("1"), tool("2"), tool("3"), text("b"), tool("4")])).toEqual(["a", "steps:1,2,3", "b", "4"]);
		const rows = transcriptRows([tool("1"), tool("2")], new Set());
		expect(rows[0]).toMatchObject({ kind: "steps", id: "1" });
	});

	it("summarizes reads, writes and failures without hiding a failed call", () => {
		const items = [
			tool("read", "succeeded", "local_read"),
			tool("write-a", "succeeded", "local_write"),
			tool("write-b", "succeeded", "local_write"),
			tool("bad", "failed", "local_exec"),
		];
		expect(summarizeSteps(items)).toEqual({ pages: 1, files: 2, commands: 0, searches: 0, other: 0, failed: 1 });
		const text = formatStepSummary(summarizeSteps(items), 4, (message, values) => message.replace("{count}", String(values?.count ?? "")));
		expect(text).toBe("read 1 page · wrote 2 files · 1 failed · 4 s");
		expect(shape(items)).toEqual(["steps:read,write-a,write-b", "bad"]);
		expect(elapsedSeconds(1_000, 5_400)).toBe(4);
		expect(elapsedSeconds(undefined, 5)).toBeUndefined();
	});

	it("never folds a call the user may need to act on or check", () => {
		for (const status of ["failed", "interrupted", "cancelled", "running", "pending"] as const) {
			expect(shape([tool("1"), tool("2"), tool("x", status), tool("3")])).toEqual(["steps:1,2", "x", "3"]);
		}
		// Waiting for approval, even if its status says otherwise, ends the run.
		expect(shape([tool("1"), tool("w"), tool("2"), tool("3")], ["w"])).toEqual(["1", "w", "steps:2,3"]);
	});
});

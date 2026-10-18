import { describe, it, expect } from "vitest";
import { toolDefinition, type AskFirstRule, type PolicySettings } from "@openbot/protocol";
import { matchesAsk, normalizeAsk } from "../src/ask-first.ts";
import { decide } from "../src/approvals.ts";
import { canonicalPath, isWithin } from "../src/policy.ts";
import { affected } from "../src/authority.ts";
const root = "/tmp/openbot-policy-test";
const rule: AskFirstRule = {
	id: "ask",
	targetId: "mac",
	revision: 1,
	createdAt: 0,
	predicate: { tool: "local_exec", program: "git", subcommand: "push" },
};
const settings: PolicySettings = { revision: 1, askFirst: [rule], commandSetting: "allow", readOnlyDefault: true, rules: [] };
const policy = {
	...settings,
	workspace: root,
	resolve: canonicalPath,
	isGranted: (path: string) => isWithin(path, canonicalPath(root, "/")),
};
const command = (text: string) => ({ tool: "local_exec", args: { command: text }, botId: "bot" });
describe("Ask first precedence and scopes", () => {
	it("requires exact approval over defaults and explicit allows; Never remains harder", () => {
		expect(decide(command("git push origin main"), toolDefinition("local_exec")!, policy).kind).toBe("ask");
		expect(decide(command("git status"), toolDefinition("local_exec")!, policy).kind).toBe("allow");
		expect(decide(command("git push"), toolDefinition("local_exec")!, { ...policy, commandSetting: "never" }).kind).toBe("deny");
	});
	it("narrows Bot/cwd/tool and conservatively matches ambiguous syntax", () => {
		const scoped = { ...rule, botId: "bot", predicate: { ...rule.predicate, cwd: canonicalPath(root, "/") } };
		expect(matchesAsk(scoped, command("git push $(cat branch)"), root)).toBe(true);
		expect(matchesAsk(scoped, { ...command("git push"), botId: "other" }, root)).toBe(false);
		expect(matchesAsk(scoped, { ...command("git push"), args: { command: "git push", cwd: "/outside" } }, root)).toBe(false);
		expect(matchesAsk(rule, command("git pushy"), root)).toBe(false);
	});
	it("normalizes literals and rejects executable predicates", () => {
		expect(normalizeAsk({ predicate: { tool: "local_exec", program: "echo", exact: 'echo "hello world"' } }, root).predicate).toMatchObject(
			{ exact: "echo 'hello world'" },
		);
		for (const exact of ["echo $HOME", "echo x > file", "echo x; echo y"])
			expect(() => normalizeAsk({ predicate: { tool: "local_exec", program: "echo", exact } }, root)).toThrow();
	});
	it("a file rule never creates a folder grant", () => {
		const files = { ...policy, askFirst: [{ ...rule, predicate: { tool: "local_write" as const, path: "/outside" } }] };
		const verdict = decide({ tool: "local_write", args: { path: "/outside/a" } }, toolDefinition("local_write")!, files);
		expect(verdict.kind).toBe("ask");
		expect(verdict).toHaveProperty("alwaysAllowOptions");
	});
	it("revokes uncertain shell dependencies while preserving unrelated file work", () => {
		const before = {
			settings: { ...settings, askFirst: [] },
			grants: [{ id: "g", path: "/outside", access: "readwrite" as const, version: 1, createdAt: 0 }],
		};
		const after = { settings: before.settings, grants: [] };
		expect(affected(before, after, command("sleep 30"), root)).toBe(true);
		expect(affected(before, after, { tool: "local_read", args: { path: "/outside/a" } }, root)).toBe(true);
		expect(affected(before, after, { tool: "local_read", args: { path: "notes.txt" } }, root)).toBe(false);
	});
});

it("rejects forged scope and unbounded predicates at the user-only protocol boundary", async () => {
	const { paramsError } = await import("@openbot/protocol/schemas");
	const input = { requestId: "r", expectedRevision: 0, predicate: { tool: "local_exec", program: "git" } };
	expect(paramsError("policy.ask.create", input)).toBeUndefined();
	for (const changed of [
		{ ...input, targetId: "foreign" },
		{ ...input, expectedRevision: -1 },
		{ ...input, predicate: { tool: "*", program: "git" } },
		{ ...input, predicate: { ...input.predicate, regex: ".*" } },
		{ ...input, predicate: { ...input.predicate, program: "x".repeat(4097) } },
	])
		expect(paramsError("policy.ask.create", changed)).toBeDefined();
});

import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { type CommandRule, toolDefinition } from "@openbot/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canonicalPath, decide, isWithin, lexCommand, type PolicySnapshot, renderPart } from "../src/index.ts";

let root: string;
let workspace: string;
let docs: string;

beforeAll(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "openbot-policy-")));
	workspace = join(root, "workspace");
	docs = join(root, "docs");
	await mkdir(join(workspace, "src"), { recursive: true });
	await mkdir(docs);
});

afterAll(async () => {
	await rm(root, { recursive: true, force: true });
});

const rule = (scope: Omit<CommandRule, "id" | "createdAt">): CommandRule => ({ id: `r-${JSON.stringify(scope)}`, createdAt: 0, ...scope });

function snapshot(overrides: Partial<Pick<PolicySnapshot, "commandSetting" | "readOnlyDefault" | "rules">> & { read?: string[] } = {}): PolicySnapshot {
	const readwrite = [workspace];
	const read = overrides.read ?? [];
	return {
		commandSetting: overrides.commandSetting ?? "ask",
		readOnlyDefault: overrides.readOnlyDefault ?? true,
		rules: overrides.rules ?? [],
		workspace,
		resolve: canonicalPath,
		isGranted: (path, access) =>
			readwrite.some((folder) => isWithin(path, folder)) || (access === "read" && read.some((folder) => isWithin(path, folder))),
	};
}

const exec = (command: string, policy: PolicySnapshot, cwd?: string) =>
	decide({ tool: "local_exec", args: { command, ...(cwd === undefined ? {} : { cwd }) } }, toolDefinition("local_exec")!, policy);

describe("lexCommand", () => {
	it("splits on pipes and list operators, keeping quoted operators inside words", () => {
		const lexed = lexCommand(`git status && echo 'a && b' | wc -l; echo "x;y"`);
		expect(lexed.ok).toBe(true);
		if (!lexed.ok) return;
		expect(lexed.parts.map(renderPart)).toEqual(["git status", "echo 'a && b'", "wc -l", "echo 'x;y'"]);
	});

	it("reads redirections with their targets and file descriptors", () => {
		const lexed = lexCommand("grep x src 2>/dev/null >out.txt");
		expect(lexed.ok && lexed.parts[0]!.redirects.map((r) => [r.fd ?? null, r.op, r.target.value])).toEqual([
			[2, ">", "/dev/null"],
			[null, ">", "out.txt"],
		]);
	});

	it.each([
		["echo $(rm -rf ~)", "substitution"],
		["echo `rm x`", "substitution"],
		['echo "$HOME"', "substitution"],
		["(cd /; rm x)", "subshell"],
		["{ rm x; }", "subshell"],
		["sleep 1 &", "background"],
		["cat <<EOF", "here-document"],
		["echo 'open", "not closed"],
		["ls |", "no command after"],
		["&& ls", "no command before"],
		["ls # comment", "comment"],
		["diff <(ls a) <(ls b)", "subshell"],
	])("does not understand %s", (command, reason) => {
		const lexed = lexCommand(command);
		expect(lexed.ok).toBe(false);
		if (!lexed.ok) expect(lexed.reason).toContain(reason);
	});
});

describe("decide: commands", () => {
	it("runs a read-only search in the workspace without asking", () => {
		expect(exec("rg foo src", snapshot())).toEqual({ kind: "allow" });
		expect(exec("git status", snapshot())).toEqual({ kind: "allow" });
		expect(exec("ls -la | wc -l", snapshot())).toEqual({ kind: "allow" });
		expect(exec("grep -rn TODO src < src/list.txt", snapshot())).toEqual({ kind: "allow" });
	});

	it.each([
		"cat ~/.ssh/id_rsa",
		"find . -exec rm {} \\;",
		"grep -rn TODO src 2>/dev/null",
		"grep x > out.txt",
		"rg --pre cat foo",
		"cat ../../etc/passwd",
		"cat /etc/passwd",
		"ls ~/*",
		"git branch -D main",
		"git push",
		"FOO=1 ls",
		"rg foo $(echo /)",
	])("asks for %s", (command) => {
		expect(exec(command, snapshot()).kind).toBe("ask");
	});

	it("asks for a read-only command outside the grants, and allows it once the folder is granted", () => {
		expect(exec("ls", snapshot(), docs).kind).toBe("ask");
		expect(exec(`cat ${join(docs, "a.txt")}`, snapshot()).kind).toBe("ask");
		expect(exec("ls", snapshot({ read: [docs] }), docs)).toEqual({ kind: "allow" });
		expect(exec(`cat ${join(docs, "a.txt")}`, snapshot({ read: [docs] }))).toEqual({ kind: "allow" });
	});

	it("turns the read-only default off with the setting", () => {
		expect(exec("rg foo src", snapshot({ readOnlyDefault: false })).kind).toBe("ask");
	});

	it("allows a command covered by a rule; a compound command with one unapproved part still asks", () => {
		const policy = snapshot({ rules: [rule({ program: "npm", subcommand: "test" })], readOnlyDefault: false });
		expect(exec("npm test -- --watch=false", policy)).toEqual({ kind: "allow" });
		expect(exec("npm test && rm -rf build", policy).kind).toBe("ask");
		expect(exec("npm install", policy).kind).toBe("ask");
		expect(exec("npm test | tee log.txt", policy).kind).toBe("ask");
	});

	it("quoting cannot smuggle a second command past an exact rule", () => {
		const policy = snapshot({ rules: [rule({ program: "echo", exact: "echo hi" })] });
		expect(exec("echo hi", policy)).toEqual({ kind: "allow" });
		expect(exec("echo 'hi'", policy)).toEqual({ kind: "allow" });
		expect(exec("echo hi; rm -rf ~", policy).kind).toBe("ask");
		expect(exec("echo hi$(rm -rf ~)", policy).kind).toBe("ask");
		expect(exec("echo 'hi; rm -rf ~'", policy).kind).toBe("ask");
		expect(exec("echo hi\nrm -rf ~", policy).kind).toBe("ask");
	});

	it("a rule allows redirection only into a writable grant", () => {
		const policy = snapshot({ rules: [rule({ program: "npm", subcommand: "test" })], read: [docs] });
		expect(exec("npm test > log.txt 2>&1", policy)).toEqual({ kind: "allow" });
		expect(exec(`npm test > ${join(docs, "log.txt")}`, policy).kind).toBe("ask");
		expect(exec(`npm test > ${join(homedir(), "log.txt")}`, policy).kind).toBe("ask");
	});

	it("offers narrow-first rule options for the one unapproved part", () => {
		const decision = exec("npm run build --prod", snapshot());
		expect(decision.kind === "ask" && decision.alwaysAllowOptions?.map((option) => option.label)).toEqual([
			"npm run build --prod",
			"npm run *",
		]);
		const twoParts = exec("npm test && make", snapshot());
		expect(twoParts.kind === "ask" && twoParts.alwaysAllowOptions).toBeUndefined();
		const unparsed = exec("echo $(date)", snapshot());
		expect(unparsed.kind === "ask" && unparsed.alwaysAllowOptions).toBeUndefined();
		const shell = exec("bash -c 'rm x'", snapshot());
		expect(shell.kind === "ask" && shell.alwaysAllowOptions?.map((option) => option.label)).toEqual(["bash -c 'rm x'"]);
	});

	it("Never beats rules and the read-only default; Always allow skips the card", () => {
		const rules = [rule({ program: "git", subcommand: "status" })];
		expect(exec("git status", snapshot({ commandSetting: "never", rules })).kind).toBe("deny");
		expect(exec("rg foo src", snapshot({ commandSetting: "never" })).kind).toBe("deny");
		expect(exec("make deploy", snapshot({ commandSetting: "allow" }))).toEqual({ kind: "allow" });
	});
});

describe("decide: files", () => {
	it("needs a readwrite grant to write and any grant to read", () => {
		const policy = snapshot({ read: [docs] });
		const read = toolDefinition("local_read")!;
		const write = toolDefinition("local_write")!;
		expect(decide({ tool: "local_read", args: { path: join(docs, "a.md") } }, read, policy)).toEqual({ kind: "allow" });
		const asked = decide({ tool: "local_write", args: { path: join(docs, "sub", "a.md"), content: "" } }, write, policy);
		expect(asked.kind).toBe("ask");
		expect(asked.kind === "ask" && asked.alwaysAllowOptions?.slice(0, 2)).toEqual([
			{ label: `Read and write ${join(docs, "sub")}`, scope: { kind: "folder", path: join(docs, "sub"), access: "readwrite" } },
			{ label: `Read and write ${docs}`, scope: { kind: "folder", path: docs, access: "readwrite" } },
		]);
		expect(decide({ tool: "local_write", args: { path: "notes.md", content: "" } }, write, policy)).toEqual({ kind: "allow" });
	});
});

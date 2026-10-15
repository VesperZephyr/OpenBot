/**
 * Which command lines run without asking (Section 5.3, backlog B5): every part of the line must match a command rule
 * or qualify as read-only inside the granted folders. Commands cannot be confined to a directory (Section 1.1), so the
 * read-only default is a convenience heuristic, kept narrow on purpose: anything the lexer cannot fully read, any
 * variable assignment, and any output redirection disqualify it.
 */
import { dirname } from "node:path";
import type { AlwaysAllowOption, CommandRule, CommandRuleScope, GrantAccess } from "@openbot/protocol";
import { type CommandPart, lexCommand, renderPart, type Word } from "./command-lexer.ts";

/** What command policy needs to know about folders: canonical resolution and grant checks (workspace included). */
export type FolderAccess = {
	/** Canonical absolute form of `path`, with `~` expanded and relative paths resolved against `base`. */
	resolve(path: string, base: string): string;
	/** Whether the canonical `path` is inside a grant that allows `access` (a `readwrite` grant allows reads). */
	isGranted(path: string, access: GrantAccess): boolean;
};

/**
 * Read-only programs (backlog B5). `git` is deliberately absent: a repository's own `.git/config` can make even
 * `git status` run programs (`core.fsmonitor`, filters, pagers), and a Bot can write that file in its workspace without
 * asking. Git commands are allowed through rules the user saves with **Always allow**.
 */
const READ_ONLY_PROGRAMS: Readonly<Record<string, true>> = {
	rg: true,
	grep: true,
	find: true,
	ls: true,
	cat: true,
	head: true,
	tail: true,
	wc: true,
	file: true,
	stat: true,
	pwd: true,
	which: true,
};
/** Options that run programs or write files, per read-only program. */
const FORBIDDEN_OPTIONS: Readonly<Record<string, readonly string[]>> = {
	find: ["-exec", "-execdir", "-ok", "-okdir", "-delete", "-fprint", "-fprint0", "-fprintf", "-fls"],
	rg: ["--pre", "--pre-glob"],
	file: ["-C", "--compile"],
};
/** Programs that run other programs from their arguments: only an exact rule may cover them. */
const RUNS_OTHERS: Readonly<Record<string, true>> = {
	sh: true,
	bash: true,
	zsh: true,
	fish: true,
	env: true,
	xargs: true,
	nohup: true,
	time: true,
	nice: true,
	command: true,
	builtin: true,
	exec: true,
	source: true,
	".": true,
	osascript: true,
};
/** Never allowed automatically, not even by an exact rule. */
const NEVER_RULED: Readonly<Record<string, true>> = { eval: true, sudo: true, su: true, doas: true };
const SUBCOMMAND = /^[a-z][a-z0-9-]*$/;
const DESCRIPTOR = /^\d+$/;

export type CommandVerdict = {
	/** Every part matches a rule or qualifies as read-only. */
	readonly allowed: boolean;
	/** **Always allow** choices when exactly one part is not allowed and a rule could cover it. */
	readonly options?: readonly AlwaysAllowOption[];
};

export function evaluateCommand(
	command: string,
	cwd: string,
	policy: { readonly rules: readonly CommandRule[]; readonly readOnlyDefault: boolean },
	folders: FolderAccess,
): CommandVerdict {
	const lexed = lexCommand(command);
	if (!lexed.ok) return { allowed: false };
	const unapproved = lexed.parts.filter(
		(part) =>
			!policy.rules.some((rule) => matchesRule(part, rule, cwd, folders)) &&
			!(policy.readOnlyDefault && isReadOnly(part, cwd, folders)),
	);
	if (unapproved.length === 0) return { allowed: true };
	// A rule covers one part; with two or more unapproved parts no single choice would let the line through.
	if (unapproved.length > 1) return { allowed: false };
	const options = ruleOptions(unapproved[0]!, cwd, folders).map((rule) => ({
		label: ruleLabel(rule),
		scope: { kind: "command" as const, rule },
	}));
	return options.length === 0 ? { allowed: false } : { allowed: false, options };
}

/** The rule as the user reads it: the exact command, or the program and subcommand followed by `*`. */
export function ruleLabel(rule: CommandRuleScope): string {
	if (rule.exact !== undefined) return rule.exact;
	return rule.subcommand === undefined ? `${rule.program} *` : `${rule.program} ${rule.subcommand} *`;
}

/**
 * Narrow first: this exact command, then the program and subcommand with any arguments. None when the saved rule would
 * not match the part again (it redirects outside the grants), so the card never offers a rule that does nothing.
 */
function ruleOptions(part: CommandPart, cwd: string, folders: FolderAccess): CommandRuleScope[] {
	if (!ruleable(part) || !redirectsGranted(part, cwd, folders)) return [];
	const [program, second] = part.words;
	const options: CommandRuleScope[] = [{ program: program!.value, exact: renderPart(part) }];
	if (RUNS_OTHERS[program!.value] === true) return options;
	if (second !== undefined && !second.expands && SUBCOMMAND.test(second.value)) {
		options.push({ program: program!.value, subcommand: second.value });
	} else if (part.words.length > 1) {
		options.push({ program: program!.value });
	}
	return options;
}

/** A part a rule may cover: a plain program name and no variable assignments. */
function ruleable(part: CommandPart): boolean {
	const program = part.words[0];
	return (
		program !== undefined &&
		!program.expands &&
		!program.value.includes("/") &&
		NEVER_RULED[program.value] !== true &&
		part.assignments.length === 0
	);
}

/** A rule matches a part with the same program (and subcommand) or the same exact words, redirecting only into grants. */
export function matchesRule(part: CommandPart, rule: CommandRule, cwd: string, folders: FolderAccess): boolean {
	if (!ruleable(part)) return false;
	const [program, second] = part.words;
	if (program!.value !== rule.program) return false;
	if (rule.exact !== undefined) {
		if (renderPart(part) !== rule.exact) return false;
	} else if (rule.subcommand !== undefined) {
		if (second === undefined || second.expands || second.value !== rule.subcommand) return false;
	} else if (RUNS_OTHERS[program!.value] === true) {
		return false;
	}
	return redirectsGranted(part, cwd, folders);
}

/** Reading from a granted file, writing into a `readwrite` grant, or duplicating a descriptor. */
function redirectsGranted(part: CommandPart, cwd: string, folders: FolderAccess): boolean {
	return part.redirects.every((redirect) => {
		if ((redirect.op === ">&" || redirect.op === "<&") && DESCRIPTOR.test(redirect.target.value)) return true;
		if (redirect.target.expands) return false;
		return folders.isGranted(folders.resolve(redirect.target.value, cwd), redirect.op === "<" ? "read" : "readwrite");
	});
}

/**
 * Read-only: an allowlisted program run in a granted folder, without forbidden options, assignments, or output
 * redirection, whose path-like arguments all resolve inside grants. Every argument that is not an option is checked as
 * a path relative to the working directory. Options that carry a path (`--file=/x`, `-f/x`, anything with `/`, `~`, or
 * `..`) are refused rather than parsed per program.
 */
export function isReadOnly(part: CommandPart, cwd: string, folders: FolderAccess): boolean {
	const [program, ...operands] = part.words;
	if (program === undefined || program.expands || part.assignments.length > 0) return false;
	if (READ_ONLY_PROGRAMS[program.value] !== true) return false;
	if (!folders.isGranted(cwd, "read")) return false;
	const forbidden = FORBIDDEN_OPTIONS[program.value] ?? [];
	for (const word of operands) {
		if (word.value.startsWith("-") && word.value !== "-") {
			if (forbidden.includes(word.value.split("=", 1)[0]!)) return false;
			if (/[/~]|\.\./.test(word.value)) return false;
		} else if (!pathGranted(word, cwd, folders)) {
			return false;
		}
	}
	return part.redirects.every((redirect) => {
		if ((redirect.op === ">&" || redirect.op === "<&") && DESCRIPTOR.test(redirect.target.value)) return true;
		return redirect.op === "<" && pathGranted(redirect.target, cwd, folders);
	});
}

/**
 * A path argument resolves inside a grant. `..` segments are refused outright: the shell applies them after following
 * symbolic links, so `link/../x` names a file next to the link's target, not next to the link. A word the shell
 * expands is checked at the literal folder before its first pattern character, and nothing after that character may
 * contain a slash: a pattern followed by `/..` would climb out of whatever folder the pattern matched.
 */
function pathGranted(word: Word, cwd: string, folders: FolderAccess): boolean {
	if (word.value === "-") return true;
	if (word.value.split("/").includes("..")) return false;
	let path = word.value;
	if (word.expands) {
		const literal = /^[^*?[#^]*/.exec(word.source)![0];
		// Quotes or escapes before the pattern change what the literal means; `~user` names another home.
		if (/["'\\]/.test(literal)) return false;
		if (literal.startsWith("~") && literal !== "~" && !literal.startsWith("~/")) return false;
		if (word.source.slice(literal.length).includes("/")) return false;
		// Without a pattern character (a word expanding only its leading `~`), the word is that one path.
		path = literal === word.source ? literal : literal === "" ? "." : literal.endsWith("/") ? literal : dirname(literal);
	}
	return folders.isGranted(folders.resolve(path, cwd), "read");
}

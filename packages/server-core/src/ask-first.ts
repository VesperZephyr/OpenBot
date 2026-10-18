import type { AskFirstInput, AskFirstRule } from "@openbot/protocol";
import { ProtocolError } from "@openbot/protocol";
import { lexCommand, renderPart } from "./command-lexer.ts";
import { canonicalPath, isWithin } from "./policy.ts";

/** Conservative literal matching; ambiguous shell syntax cannot prove a scoped rule irrelevant. */
export function matchesAsk(
	rule: AskFirstRule,
	call: { tool: string; botId?: string; args: Readonly<Record<string, unknown>> },
	workspace: string,
): boolean {
	if (rule.botId && rule.botId !== call.botId) return false;
	const p = rule.predicate;
	if (p.tool !== call.tool) return false;
	if (p.tool !== "local_exec") return typeof call.args.path === "string" && isWithin(canonicalPath(call.args.path, workspace), p.path);
	const cwd = canonicalPath(typeof call.args.cwd === "string" ? call.args.cwd : ".", workspace);
	if (p.cwd && !isWithin(cwd, p.cwd)) return false;
	const parsed = lexCommand(typeof call.args.command === "string" ? call.args.command : "");
	if (!parsed.ok) return true;
	return parsed.parts.some((part) => {
		const [program, subcommand] = part.words;
		if (!program || program.expands) return true;
		if (program.value !== p.program) return false;
		if (p.exact !== undefined) return renderPart(part) === p.exact;
		return p.subcommand === undefined || (!!subcommand && (subcommand.expands || subcommand.value === p.subcommand));
	});
}
export function normalizeAsk(input: AskFirstInput, workspace: string): AskFirstInput {
	const p = input.predicate;
	if (p.tool !== "local_exec") return { ...input, predicate: { ...p, path: canonicalPath(p.path, workspace) } };
	if (p.subcommand && p.exact) throw new ProtocolError("invalid_request", "Choose a subcommand or an exact command, not both");
	for (const value of [p.program, p.subcommand])
		if (value !== undefined && (!value.trim() || /[\s\x00-\x1f*?{}$`;&|<>]/.test(value)))
			throw new ProtocolError("invalid_request", "Programs and subcommands must be literal words");
	let exact = p.exact;
	if (exact !== undefined) {
		const parsed = lexCommand(exact);
		if (
			!parsed.ok ||
			parsed.parts.length !== 1 ||
			parsed.parts[0]!.assignments.length ||
			parsed.parts[0]!.redirects.length ||
			parsed.parts[0]!.words.some((word) => word.expands) ||
			parsed.parts[0]!.words[0]?.value !== p.program
		)
			throw new ProtocolError("invalid_request", "Exact commands must contain one literal command without redirections");
		exact = renderPart(parsed.parts[0]!);
	}
	return {
		...input,
		predicate: {
			...p,
			...(exact === undefined ? {} : { exact }),
			...(p.cwd === undefined ? {} : { cwd: canonicalPath(p.cwd, workspace) }),
		},
	};
}

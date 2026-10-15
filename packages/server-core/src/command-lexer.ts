/**
 * A small, conservative lexer for the command lines `local_exec` runs with `/bin/zsh -c`. It understands words with
 * single quotes, double quotes, and backslash escapes; the separators `|`, `&&`, `||`, `;`, and newlines; and file
 * redirections. Everything else that makes the shell compute or run something the text does not spell out (parameter
 * and command substitution, backticks, subshells and groups, brace expansion, here-documents, background jobs,
 * process substitution, comments, `!`) makes the line not understood: such a line is never allowed automatically.
 *
 * The lexer only reads; policy decides what the parts may do (`command-policy.ts`).
 */

/** One shell word. `expands` marks unquoted glob characters or a leading `~`: the shell rewrites the word. */
export type Word = { readonly value: string; readonly expands: boolean; readonly source: string };

export type RedirectOp = "<" | "<&" | ">" | ">>" | ">|" | ">&" | "&>" | "&>>";

export type Redirect = { readonly fd?: number; readonly op: RedirectOp; readonly target: Word };

/** One simple command: leading variable assignments, its words (program first), and its redirections. */
export type CommandPart = {
	readonly assignments: readonly string[];
	readonly words: readonly Word[];
	readonly redirects: readonly Redirect[];
};

export type LexResult =
	| { readonly ok: true; readonly parts: readonly CommandPart[] }
	| { readonly ok: false; readonly reason: string };

type Separator = "|" | "||" | "&&" | ";" | "start";

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const PLAIN = /^[A-Za-z0-9_@%+=:,./-]+$/;

class NotUnderstood extends Error {}

export function lexCommand(command: string): LexResult {
	try {
		return { ok: true, parts: lex(command) };
	} catch (error) {
		if (error instanceof NotUnderstood) return { ok: false, reason: error.message };
		throw error;
	}
}

/** The word as the shell would read it back: plain words as is, others single-quoted; expanding words verbatim. */
export function renderWord(word: Word): string {
	if (word.expands) return word.source;
	if (PLAIN.test(word.value)) return word.value;
	return `'${word.value.replaceAll("'", `'\\''`)}'`;
}

/** The part's words, rendered canonically; what an exact command rule compares. Redirections are not included. */
export function renderPart(part: CommandPart): string {
	return part.words.map(renderWord).join(" ");
}

function lex(command: string): CommandPart[] {
	const parts: CommandPart[] = [];
	let assignments: string[] = [];
	let words: Word[] = [];
	let redirects: Redirect[] = [];
	let pending: { fd?: number; op: RedirectOp } | undefined;
	let previous: Separator = "start";

	let value = "";
	let source = "";
	let expands = false;
	let quoted = false;
	let active = false;

	const fail = (reason: string): never => {
		throw new NotUnderstood(reason);
	};
	const append = (text: string, raw: string): void => {
		value += text;
		source += raw;
		active = true;
	};
	const endWord = (): void => {
		if (!active) return;
		const word: Word = { value, expands, source };
		if (pending !== undefined) {
			redirects.push({ ...pending, target: word });
			pending = undefined;
		} else if (words.length === 0 && !quoted && ASSIGNMENT.test(source)) {
			assignments.push(source);
		} else {
			words.push(word);
		}
		value = "";
		source = "";
		expands = false;
		quoted = false;
		active = false;
	};
	const endPart = (separator: Separator | "end"): void => {
		endWord();
		if (pending !== undefined) fail("A redirection has no target");
		const empty = assignments.length === 0 && words.length === 0 && redirects.length === 0;
		if (empty) {
			// Only `;` and newlines may stand alone (leading, trailing, or repeated); operators need a command each side.
			if (previous === "|" || previous === "||" || previous === "&&") fail("An operator has no command after it");
			if (separator === "|" || separator === "||" || separator === "&&") fail("An operator has no command before it");
		} else {
			parts.push({ assignments, words, redirects });
		}
		assignments = [];
		words = [];
		redirects = [];
		if (separator !== "end") previous = separator;
	};

	let i = 0;
	while (i < command.length) {
		const c = command[i]!;
		const next = command[i + 1];
		if (c === " " || c === "\t") {
			endWord();
			i += 1;
		} else if (c === "\n") {
			endPart(";");
			i += 1;
		} else if (c === "\\") {
			if (next === undefined) fail("The command ends with a backslash");
			// A backslash-newline joins lines; it adds nothing to the word.
			if (next !== "\n") {
				append(next!, `\\${next}`);
				quoted = true;
			}
			i += 2;
		} else if (c === "'") {
			const close = command.indexOf("'", i + 1);
			if (close < 0) fail("A single quote is not closed");
			append(command.slice(i + 1, close), command.slice(i, close + 1));
			quoted = true;
			i = close + 1;
		} else if (c === '"') {
			let j = i + 1;
			let text = "";
			for (;;) {
				const ch = command[j];
				if (ch === undefined) fail("A double quote is not closed");
				if (ch === '"') break;
				if (ch === "$" || ch === "`") fail("The command uses substitution");
				if (ch === "\\") {
					const escaped = command[j + 1];
					if (escaped === undefined) fail("A double quote is not closed");
					if (escaped === '"' || escaped === "\\") text += escaped;
					else if (escaped !== "\n") text += `\\${escaped}`;
					j += 2;
					continue;
				}
				text += ch;
				j += 1;
			}
			append(text, command.slice(i, j + 1));
			quoted = true;
			i = j + 1;
		} else if (c === "$" || c === "`") {
			fail("The command uses substitution");
		} else if (c === "(" || c === ")" || c === "{" || c === "}") {
			fail("The command uses a subshell, group, or brace expansion");
		} else if (c === "!") {
			fail("The command uses `!`");
		} else if (c === "#" && !active) {
			fail("The command contains a comment");
		} else if (c === "=" && !active) {
			// zsh expands a leading `=name` to the program's path.
			fail("The command uses `=` expansion");
		} else if (c === "|" || c === "&" || c === ";" || c === "<" || c === ">") {
			let fd: number | undefined;
			// `2>` and friends: digits right before a redirection operator name a file descriptor.
			if ((c === "<" || c === ">") && active && !quoted && !expands && /^\d+$/.test(source)) {
				fd = Number(source);
				value = "";
				source = "";
				active = false;
			}
			endWord();
			if (pending !== undefined) fail("A redirection has no target");
			const two = command.slice(i, i + 2);
			const three = command.slice(i, i + 3);
			let separator: Separator | undefined;
			let op: RedirectOp | undefined;
			let length = 1;
			if (two === "||" || two === "&&") [separator, length] = [two, 2];
			else if (two === "|&") fail("The command uses `|&`");
			else if (c === "|") separator = "|";
			else if (three === "&>>") [op, length] = ["&>>", 3];
			else if (two === "&>") [op, length] = ["&>", 2];
			else if (c === "&") fail("The command runs something in the background");
			else if (two === ";;") fail("The command uses `;;`");
			else if (c === ";") separator = ";";
			else if (two === "<<") fail("The command uses a here-document");
			else if (two === "<>") fail("The command opens a file for reading and writing");
			else if (two === "<&") [op, length] = ["<&", 2];
			else if (c === "<") op = "<";
			else if (two === ">>" || two === ">|" || two === ">&") [op, length] = [two, 2];
			else op = ">";
			if (separator !== undefined) {
				if (fd !== undefined) fail("A file descriptor has no redirection");
				endPart(separator);
			} else {
				pending = fd === undefined ? { op: op! } : { fd, op: op! };
			}
			i += length;
		} else {
			// Globs, a leading `~`, and zsh's extended-glob characters make the shell rewrite the word.
			if (c === "*" || c === "?" || c === "[" || c === "#" || c === "^" || (c === "~" && !active)) expands = true;
			append(c, c);
			i += 1;
		}
	}
	endPart("end");
	if (parts.length === 0) fail("The command is empty");
	return parts;
}

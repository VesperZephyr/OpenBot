import { readFileSync } from "node:fs";
import path from "node:path";

/** Sorted public export names of a TypeScript entry, including `export type` and `export *`. */
export function exportedNames(entry: string): string[] {
	const names = new Set<string>();
	const seen = new Set<string>();
	const visit = (file: string) => {
		const abs = path.resolve(file);
		if (seen.has(abs)) return;
		seen.add(abs);
		const text = readFileSync(abs, "utf8");
		const dir = path.dirname(abs);
		let i = 0;
		while (i < text.length) {
			if (isSpace(text[i])) {
				i++;
				continue;
			}
			if (text.startsWith("//", i)) {
				const end = text.indexOf("\n", i);
				i = end === -1 ? text.length : end + 1;
				continue;
			}
			if (text.startsWith("/*", i)) {
				const end = text.indexOf("*/", i + 2);
				i = end === -1 ? text.length : end + 2;
				continue;
			}
			if (text[i] === '"' || text[i] === "'" || text[i] === "`") {
				i = skipString(text, i);
				continue;
			}
			if (text.startsWith("export", i) && isBoundary(text, i) && isSpace(text[i + 6])) {
				i = readExport(text, i, dir, names, visit);
				continue;
			}
			i++;
		}
	};
	visit(entry);
	return [...names].sort();
}

function readExport(text: string, i: number, dir: string, names: Set<string>, visit: (file: string) => void): number {
	let j = skipSpace(text, i + 6);
	if (text.startsWith("type", j) && isSpace(text[j + 4])) {
		const after = skipSpace(text, j + 4);
		if (text[after] === "{") {
			const parsed = parseClause(text, after);
			for (const name of parsed.names) names.add(name);
			return parsed.i;
		}
	}
	if (text[j] === "{") {
		const parsed = parseClause(text, j);
		for (const name of parsed.names) names.add(name);
		return parsed.i;
	}
	if (text[j] === "*") {
		const spec = text.slice(j).match(/^\*\s+from\s+["']([^"']+)["']/);
		const from = spec?.[1];
		if (!spec || from === undefined) throw new Error(`Unparsed export * at ${JSON.stringify(text.slice(j, j + 40))}`);
		if (from.startsWith(".")) visit(path.resolve(dir, from));
		return j + spec[0].length;
	}
	const decl = text.slice(j).match(/^(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:type|interface|class|function|const|let|var|enum)\s+([A-Za-z0-9_]+)/);
	const declared = decl?.[1];
	if (!decl || declared === undefined) throw new Error(`Unparsed export at ${JSON.stringify(text.slice(i, i + 80))}`);
	names.add(declared);
	return j + decl[0].length;
}

function parseClause(text: string, i: number): { names: string[]; i: number } {
	if (text[i] !== "{") throw new Error("expected export list");
	i++;
	const names: string[] = [];
	while (i < text.length) {
		i = skipSpace(text, i);
		if (text[i] === "}") return { names, i: i + 1 };
		if (text.startsWith("type", i) && isSpace(text[i + 4])) i = skipSpace(text, i + 4);
		const id = text.slice(i).match(/^[A-Za-z0-9_]+/);
		if (!id) throw new Error(`Unparsed export name at ${JSON.stringify(text.slice(i, i + 40))}`);
		i += id[0].length;
		i = skipSpace(text, i);
		let exported = id[0];
		if (text.startsWith("as", i) && isSpace(text[i + 2])) {
			i = skipSpace(text, i + 2);
			const alias = text.slice(i).match(/^[A-Za-z0-9_]+/);
			if (!alias) throw new Error("Unparsed export alias");
			exported = alias[0];
			i += alias[0].length;
			i = skipSpace(text, i);
		}
		names.push(exported);
		if (text[i] === ",") {
			i++;
			continue;
		}
		if (text[i] === "}") return { names, i: i + 1 };
		throw new Error(`Unparsed export list at ${JSON.stringify(text.slice(i, i + 30))}`);
	}
	throw new Error("Unterminated export list");
}

function skipString(source: string, i: number): number {
	const quote = source[i];
	i++;
	while (i < source.length) {
		if (source[i] === "\\") {
			i += 2;
			continue;
		}
		if (quote === "`" && source[i] === "$" && source[i + 1] === "{") {
			i += 2;
			let depth = 1;
			while (i < source.length && depth > 0) {
				if (source[i] === "{") depth++;
				else if (source[i] === "}") depth--;
				i++;
			}
			continue;
		}
		if (source[i] === quote) return i + 1;
		i++;
	}
	return i;
}

function skipSpace(source: string, i: number): number {
	while (i < source.length && isSpace(source[i])) i++;
	return i;
}

function isSpace(char: string | undefined): boolean {
	return char !== undefined && /\s/.test(char);
}

function isBoundary(source: string, i: number): boolean {
	return i === 0 || !/[A-Za-z0-9_$]/.test(source[i - 1] ?? "");
}

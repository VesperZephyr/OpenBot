/**
 * Bot memory: Markdown of at most `MEMORY_LIMIT_BYTES`, one value per Bot, split into `## ` sections that
 * `memory_update` edits one at a time.
 */
import { defineDocFamily } from "@earendil-works/pi-durable";
import { MEMORY_LIMIT_BYTES, ProtocolError } from "@openbot/protocol";

/**
 * Session-scoped and keyed by `botId`: memory belongs to the Bot, not to one conversation, so any conversation the
 * Bot works in reads the same value, and a reset or fork of its conversation leaves it alone.
 */
export const MemoryDoc = defineDocFamily<{ content: string }, null>({
	kind: "openbot.memory",
	version: 1,
	family: true,
	scope: "session",
	initial: () => ({ content: "" }),
});

export type MemoryEdit = {
	readonly action: "replace" | "append";
	/** Heading text without the `## ` prefix. */
	readonly section: string;
	readonly content: string;
};

type Section = { readonly heading: string; body: string };

/**
 * Apply one section edit. `append` adds the content as a line unless the section already holds it, so replaying the
 * same call changes nothing; `replace` sets the body, and empty content removes the section. A missing section is
 * added at the end. Text before the first heading is kept.
 */
export function applyMemoryEdit(memory: string, edit: MemoryEdit): string {
	const heading = edit.section.trim().replace(/^#+\s*/, "");
	if (heading === "") throw new ProtocolError("invalid_request", "Name the memory section to change");
	const content = edit.content.trim();
	const { preamble, sections } = parse(memory);
	const key = heading.toLowerCase();
	const index = sections.findIndex((section) => section.heading.toLowerCase() === key);
	if (edit.action === "replace") {
		if (content === "") {
			if (index >= 0) sections.splice(index, 1);
		} else if (index >= 0) {
			sections[index]!.body = content;
		} else {
			sections.push({ heading, body: content });
		}
	} else {
		if (content === "") throw new ProtocolError("invalid_request", "Nothing to append");
		const section = index >= 0 ? sections[index]! : sections[sections.push({ heading, body: "" }) - 1]!;
		if (!section.body.includes(content)) section.body = section.body === "" ? content : `${section.body}\n${content}`;
	}
	return render(preamble, sections);
}

/** Reject memory above the limit with a message the model or the user can act on. */
export function checkMemorySize(content: string): void {
	const bytes = new TextEncoder().encode(content).length;
	if (bytes > MEMORY_LIMIT_BYTES) {
		throw new ProtocolError(
			"invalid_request",
			`Memory is limited to ${MEMORY_LIMIT_BYTES / 1024} KB; this change would make it ${bytes} bytes. Shorten or remove older notes first.`,
		);
	}
}

function parse(memory: string): { preamble: string; sections: Section[] } {
	const sections: Section[] = [];
	const preamble: string[] = [];
	let current: { heading: string; lines: string[] } | undefined;
	const flush = (): void => {
		if (current !== undefined) sections.push({ heading: current.heading, body: current.lines.join("\n").trim() });
	};
	for (const line of memory.split("\n")) {
		const match = /^##\s+(.+?)\s*$/.exec(line);
		if (match !== null) {
			flush();
			current = { heading: match[1]!, lines: [] };
		} else if (current === undefined) {
			preamble.push(line);
		} else {
			current.lines.push(line);
		}
	}
	flush();
	return { preamble: preamble.join("\n").trim(), sections };
}

function render(preamble: string, sections: readonly Section[]): string {
	const blocks = sections.map((section) => (section.body === "" ? `## ${section.heading}` : `## ${section.heading}\n${section.body}`));
	return (preamble === "" ? blocks : [preamble, ...blocks]).join("\n\n");
}

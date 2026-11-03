/** Up to three clickable prompts already present in instructions or skill descriptions. */
export function conversationExamples(
	instructions: string,
	skills: readonly { readonly description: string }[],
): readonly string[] {
	const found: string[] = [];
	const push = (value: string | undefined): void => {
		const text = value?.replace(/\s+/g, " ").trim();
		if (!text || text.length < 8 || text.length > 140) return;
		if (found.some((item) => item.toLocaleLowerCase() === text.toLocaleLowerCase())) return;
		found.push(text);
	};
	for (const match of instructions.matchAll(/[“"]([^“”"\n]{8,140})[”"]/g)) push(match[1]);
	for (const line of instructions.split("\n")) {
		const labeled = /^(?:[-*]|\d+[.)])?\s*(?:example|示例)\s*[:：]\s*(.{8,140})$/i.exec(line.trim());
		push(labeled?.[1]);
	}
	for (const skill of skills) push(skill.description);
	return found.slice(0, 3);
}

/** The Bot's own first sentence, when its instructions contain one. */
export function botGreeting(instructions: string): string {
	const line = instructions
		.split(/\n+/)
		.map((item) => item.trim())
		.find(Boolean);
	if (!line) return "";
	const sentence = line.split(/(?<=[.!?。！？])\s/)[0] ?? line;
	return sentence.length > 180 ? `${sentence.slice(0, 179)}…` : sentence;
}

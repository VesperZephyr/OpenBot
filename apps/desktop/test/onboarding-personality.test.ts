import { expect, it } from "vitest";
import { instructionsWithPersonality } from "../src/renderer/src/features/onboarding/personality.ts";

const BASE = "You are the user's personal assistant. Help with everyday tasks.";
const LINE = "Keep answers short and warm.";

it("appends a personality sentence once and replaces it on the next save", () => {
	let instructions = BASE;
	let applied = "";
	const save = (personality: string): string => {
		instructions = instructionsWithPersonality(instructions, personality, applied);
		applied = personality.trim();
		return instructions;
	};

	expect(save(LINE)).toBe(`${BASE}\n\n${LINE}`);
	expect(save(LINE).split(LINE)).toHaveLength(2);
	expect(save(`  ${LINE}  `)).toBe(`${BASE}\n\n${LINE}`);
	expect(save("Be playful, not formal.")).toBe(`${BASE}\n\nBe playful, not formal.`);
	expect(save("Be playful, not formal.").includes(LINE)).toBe(false);
	expect(save("")).toBe(BASE);
});

it("does not append a sentence that is already the trailing paragraph", () => {
	const once = `${BASE}\n\n${LINE}`;
	expect(instructionsWithPersonality(once, LINE, "")).toBe(once);
	expect(instructionsWithPersonality(once, LINE, LINE)).toBe(once);
});

it("leaves an earlier copy in place when a newer paragraph follows it", () => {
	const current = `${BASE}\n\n${LINE}\n\nMore notes.`;
	expect(instructionsWithPersonality(current, "Next sentence.", LINE)).toBe(`${current}\n\nNext sentence.`);
});

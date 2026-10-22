import { expect, it } from "vitest";
import { composeRoleSkills } from "../src/role-skills.ts";
const ref = { name: "report", revision: 1, sha256: "a".repeat(64) };

it("deduplicates identical pins but rejects version ambiguity and excess methods", () => {
	expect(composeRoleSkills([ref], [ref])).toEqual([ref]);
	expect(() => composeRoleSkills([], [ref, ref])).toThrow("distinct skills");
	expect(() => composeRoleSkills([ref], [{ ...ref, revision: 2 }])).toThrow("different versions");
	expect(() => composeRoleSkills([ref], [{ ...ref, sha256: "b".repeat(64) }])).toThrow("different versions");
	expect(() => composeRoleSkills([ref], [{ ...ref, name: "second" }, { ...ref, name: "third" }])).toThrow("exceed two");
	expect(() => composeRoleSkills([{ ...ref, revision: 0 }], [])).toThrow("exact skill reference");
});

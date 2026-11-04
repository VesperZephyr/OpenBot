import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { defaultAvatar } from "@openbot/protocol";
import { describe, expect, it } from "vitest";
import { avatarColorIndex, avatarShape } from "../src/renderer/src/avatar-appearance";

const expected = [
	["bot_core", 1287337752, "leaf", 0, 0],
	["bot_alpha", 2998701621, "leaf", 3, 1],
	["bot_reviewer", 4007021800, "leaf", 4, 0],
	["bot_0123456789abcdef", 2572814767, "leaf", 1, 2],
	["OpenBot", 1551256970, "leaf", 2, 2],
	["研究助手", 3832696635, "leaf", 3, 2],
	["atlas", 3407328204, "leaf", 0, 1],
	["scribe", 4245756147, "leaf", 3, 1],
] as const;

describe("default avatar mapping", () => {
	it("keeps seed, motif, color index and shape for fixed Bot ids", () => {
		for (const [id, seed, motif, colorIndex, shape] of expected) {
			const avatar = defaultAvatar(id);
			expect(avatar).toEqual({ kind: "generated", version: 1, seed, motif });
			expect(avatarColorIndex(avatar.seed)).toBe(colorIndex);
			expect(avatarShape(avatar.seed)).toBe(shape);
		}
	});

	it("does not import the design-study avatar script", () => {
		const roots = [join(import.meta.dirname, "../src"), join(import.meta.dirname, "../../../packages")];
		const hits: string[] = [];
		const walk = (dir: string): void => {
			for (const entry of readdirSync(dir, { withFileTypes: true })) {
				if (entry.name === "node_modules" || entry.name === "dist") continue;
				const path = join(dir, entry.name);
				if (entry.isDirectory()) walk(path);
				else if (/\.(ts|tsx|js|mjs|css)$/.test(entry.name) && readFileSync(path, "utf8").includes("avatars.js")) hits.push(path);
			}
		};
		for (const root of roots) walk(root);
		expect(hits).toEqual([]);
	});
});

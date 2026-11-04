import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { defaultAvatar } from "@openbot/protocol";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/store", () => ({
	api: {},
	useStore: () => undefined,
}));

import { avatarColorIndex } from "../src/renderer/src/Avatar";

const expected = [
	["bot_core", 1287337752, 0],
	["bot_alpha", 2998701621, 3],
	["bot_reviewer", 4007021800, 4],
	["bot_0123456789abcdef", 2572814767, 1],
	["OpenBot", 1551256970, 2],
	["研究助手", 3832696635, 3],
	["atlas", 3407328204, 0],
	["scribe", 4245756147, 3],
] as const;

describe("default avatar mapping", () => {
	it("keeps seed, motif and color index for fixed Bot ids", () => {
		for (const [id, seed, colorIndex] of expected) {
			const avatar = defaultAvatar(id);
			expect(avatar).toEqual({ kind: "generated", version: 1, seed, motif: "leaf" });
			expect(avatarColorIndex(avatar.seed)).toBe(colorIndex);
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

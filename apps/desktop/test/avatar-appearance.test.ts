import { defaultAvatar } from "@openbot/protocol";
import { describe, expect, it } from "vitest";
import { generatedAvatarAppearance } from "../src/renderer/src/avatar-appearance";

const expected = [
	["bot_core", 1287337752, 0, 0],
	["bot_alpha", 2998701621, 3, 1],
	["bot_reviewer", 4007021800, 4, 0],
	["bot_0123456789abcdef", 2572814767, 1, 2],
	["OpenBot", 1551256970, 2, 2],
	["研究助手", 3832696635, 3, 2],
	["atlas", 3407328204, 0, 1],
	["scribe", 4245756147, 3, 1],
] as const;

describe("default avatar mapping", () => {
	it("keeps seed, motif, color index and shape for fixed Bot ids", () => {
		for (const [id, seed, colorIndex, shape] of expected) {
			const avatar = defaultAvatar(id);
			expect(avatar).toEqual({ kind: "generated", version: 1, seed, motif: "leaf" });
			expect(generatedAvatarAppearance(avatar)).toEqual({ colorIndex, shape });
		}
	});
});

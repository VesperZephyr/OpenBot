import { expect, it } from "vitest";
import { identityWho } from "../src/prompt.ts";

it("describes a Bot's role once in the identity prompt", () => {
	expect(identityWho({ name: "Scout", role: "Research" })).toBe("Scout, the user's Research Bot");
	expect(identityWho({ name: "OpenBot", role: "Personal assistant" })).toBe("OpenBot, the user's Personal assistant Bot");
	expect(identityWho({ name: "Piper", role: "New Bot" })).toBe("Piper, the user's New Bot");
	expect(identityWho({ name: "Piper", role: "  new bot  " })).toBe("Piper, the user's new bot");
	expect(identityWho({ name: "Rex", role: "Robot" })).toBe("Rex, the user's Robot Bot");
	expect(identityWho({ name: "Piper", role: "  " })).toBe("Piper");
	expect(identityWho(undefined)).toBe("a Bot");
});

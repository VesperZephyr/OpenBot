import { expect, it } from "vitest";
import { hostCalls } from "../src/renderer/src/host-calls.ts";

it("invokes a replaced host method and still forwards the others", async () => {
	const seen: unknown[] = [];
	const calls = hostCalls({
		"settings.update": (params: { language?: string }) => {
			seen.push(params);
			return Promise.resolve("saved");
		},
		"settings.get": () => Promise.resolve("loaded"),
	} as never);
	const mutable = calls as unknown as { "settings.update": (params: { language?: string }) => Promise<unknown> };
	mutable["settings.update"] = () => Promise.reject(new Error("language save failed"));
	await expect(mutable["settings.update"]({ language: "zh-CN" })).rejects.toThrow("language save failed");
	expect(seen).toEqual([]);
	await expect(calls["settings.get"]({})).resolves.toBe("loaded");
});

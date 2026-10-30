import { describe, expect, it } from "vitest";
import { hostClock } from "../src/test-clock.ts";

describe("hostClock", () => {
	it("is the wall clock unless a test clock file is configured", () => {
		const wallClock = () => 1_000;
		expect(hostClock(undefined, { wallClock })()).toBe(1_000);
		expect(hostClock("", { wallClock })()).toBe(1_000);
	});

	it("adds the offset a test writes, picking up changes after the refresh interval", () => {
		let wall = 10_000,
			file = "";
		const now = hostClock("/clock", { wallClock: () => wall, read: () => file });
		expect(now()).toBe(10_000);
		file = "60000";
		wall += 50;
		expect(now()).toBe(10_050);
		wall += 50;
		expect(now()).toBe(70_100);
	});

	it("never moves backwards for a lower, invalid or missing offset", () => {
		let wall = 0,
			file: string | undefined = "5000";
		const now = hostClock("/clock", {
			wallClock: () => wall,
			read: () => {
				if (file === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
				return file;
			},
		});
		expect(now()).toBe(5_000);
		for (const next of ["1000", "-1", "soon", "1.5", undefined]) {
			file = next;
			wall += 100;
			expect(now()).toBe(wall + 5_000);
		}
	});
});

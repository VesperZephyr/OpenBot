import { afterAll, beforeAll, expect, it } from "vitest";
import { setTimeout } from "node:timers/promises";

beforeAll(async () => { await setTimeout(120); });
afterAll(async () => { await setTimeout(120); });
it("records hooks around a short assertion", () => {
	expect(process.env.OPENBOT_TIMING_FIXTURE_FAIL).not.toBe("1");
});

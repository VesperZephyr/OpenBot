import { describe, expect, it } from "vitest";
import { desktopTestMode } from "../src/main/test-mode";

describe("desktop test mode", () => {
	it("requires an explicit mode and isolated data", () => {
		expect(desktopTestMode(false, {})).toBeUndefined();
		expect(desktopTestMode(false, { OPENBOT_E2E_MODE: "background" })).toBeUndefined();
		expect(desktopTestMode(false, { OPENBOT_DATA_DIR: "/tmp/test", OPENBOT_E2E_MODE: "typo" })).toBeUndefined();
	});
	it.each(["background", "headed"])("accepts %s only for unpackaged isolated launches", (mode) => {
		const env = { OPENBOT_DATA_DIR: "/tmp/test", OPENBOT_E2E_MODE: mode };
		expect(desktopTestMode(false, env)).toBe(mode);
		expect(desktopTestMode(true, env)).toBeUndefined();
	});
});

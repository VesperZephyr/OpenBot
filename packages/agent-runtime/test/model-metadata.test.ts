import { describe, expect, it } from "vitest";
import { modelTestError, safeEndpoint } from "../src/index.ts";

describe("model metadata privacy", () => {
	it("removes every credential-bearing URL component", () => {
		expect(safeEndpoint("https://user:secret@example.com/private/token?api_key=secret#secret")).toBe("https://example.com");
		expect(safeEndpoint("file:///private/secret")).toBe("Custom endpoint");
	});
	it("never forwards provider failure bodies", () => {
		for (const message of ["401 secret", "404 secret", "timeout secret", "429 secret", "header secret"]) {
			expect(modelTestError(message)).not.toContain("secret");
		}
		expect(modelTestError("401 private body")).toContain("Authentication");
	});
});

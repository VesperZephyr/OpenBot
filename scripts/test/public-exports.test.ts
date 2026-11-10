import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { exportedNames } from "./exported-names.ts";

const root = path.resolve(import.meta.dirname, "../..");

function expectExports(entry: string, fixture: string) {
	const expected = JSON.parse(readFileSync(path.join(import.meta.dirname, fixture), "utf8")) as string[];
	expect(exportedNames(path.join(root, entry))).toEqual(expected);
}

describe("package entry exports", () => {
	it("keeps the protocol entry's public names", () => {
		expectExports("packages/protocol/src/index.ts", "protocol-exports.json");
	});

	it("keeps the server-core entry's public names", () => {
		expectExports("packages/server-core/src/index.ts", "server-core-exports.json");
	});
});

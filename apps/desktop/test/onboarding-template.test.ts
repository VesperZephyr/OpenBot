import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { TEMPLATE_SCHEMA, normalizeTemplate } from "@openbot/protocol";

const { Compile } = createRequire(fileURLToPath(new URL("../../../packages/protocol/package.json", import.meta.url)))("typebox/compile") as {
	Compile: (schema: unknown) => { Check: (value: unknown) => boolean };
};

const template = JSON.parse(
	readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/renderer/src/features/onboarding/research-bot.json"), "utf8"),
);

it("accepts the built-in research template", () => {
	expect(Compile(TEMPLATE_SCHEMA).Check(template)).toBe(true);
	expect(normalizeTemplate(template).profile).toMatchObject({ name: "Research", role: "Research", model: null });
});

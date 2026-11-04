import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Compile } from "typebox/compile";
import { expect, it } from "vitest";
import { TEMPLATE_SCHEMA, normalizeTemplate } from "../src/templates.ts";

const template = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../apps/desktop/src/renderer/src/features/onboarding/research-bot.json"), "utf8"));

it("accepts the built-in research template", () => {
	expect(Compile(TEMPLATE_SCHEMA).Check(template)).toBe(true);
	expect(normalizeTemplate(template).profile).toMatchObject({ name: "Research", role: "Research", model: null });
});

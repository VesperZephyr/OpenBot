import { expect, it } from "vitest";
import {
	normalizeTemplate,
	parseTemplateJson,
	canonicalTemplateJson,
	normalizeTemplateChoices,
	TEMPLATE_LIMITS,
	templateIpcSize,
} from "../src/templates.ts";
import { paramsError, validArtifactRequest } from "../src/schemas.ts";
const doc = () => ({
	format: "openbot-bot-template",
	version: 1,
	profile: {
		name: "  Reader  ",
		role: "研究",
		instructions: "Do research 🧭",
		avatar: { kind: "generated", version: 1, seed: 1, motif: "leaf" },
		model: null,
		thinkingLevel: "off",
		defaultSkills: [],
	},
});
it("accepts exact byte and Unicode boundaries and rejects one unit beyond them", () => {
	const base = doc(),
		text = JSON.stringify(base);
	expect(parseTemplateJson(text + " ".repeat(TEMPLATE_LIMITS.fileBytes - Buffer.byteLength(text)))).toEqual(
		normalizeTemplate(base),
	);
	for (const field of ["name", "role"]) {
		expect(() => normalizeTemplate({ ...base, profile: { ...base.profile, [field]: "🧭".repeat(200) } })).not.toThrow();
		expect(() => normalizeTemplate({ ...base, profile: { ...base.profile, [field]: "🧭".repeat(201) } })).toThrow();
	}
	expect(templateIpcSize("a".repeat(TEMPLATE_LIMITS.ipcBytes - 2))).toBe(true);
	expect(templateIpcSize("a".repeat(TEMPLATE_LIMITS.ipcBytes - 1))).toBe(false);
	for (const ref of [
		{ name: "../escape", revision: 1, sha256: "a".repeat(64) },
		{ name: "report", revision: 0, sha256: "a".repeat(64) },
		{ name: "report", revision: Number.MAX_SAFE_INTEGER + 1, sha256: "a".repeat(64) },
		{ name: "report", revision: 1, sha256: "A".repeat(64) },
	])
		expect(() => normalizeTemplate({ ...base, profile: { ...base.profile, defaultSkills: [ref] } })).toThrow();
	expect(() =>
		normalizeTemplate({
			...base,
			profile: { ...base.profile, model: { provider: "p", modelId: "m", endpoint: "private", secret: "private" } },
		}),
	).toThrow();
});
it("canonicalizes Unicode and key order without changing arrays or instruction whitespace", () => {
	const value = normalizeTemplate(doc());
	expect(value.profile.name).toBe("Reader");
	expect(canonicalTemplateJson({ z: [2, 1], a: { z: "中", a: 1 } })).toBe('{"a":{"a":1,"z":"中"},"z":[2,1]}');
	expect(parseTemplateJson("\ufeff" + JSON.stringify(doc(), null, 2))).toEqual(value);
	expect(parseTemplateJson(canonicalTemplateJson(value) + "\n")).toEqual(value);
});
it("rejects duplicate escaped keys, trailing input, comments, prototype keys and excessive nesting", () => {
	for (const value of [
		'{"a":1,"\\u0061":2}',
		JSON.stringify(doc()) + " true",
		"/* comment */" + JSON.stringify(doc()),
		'{"__proto__":{}}',
		"[".repeat(10) + "0" + "]".repeat(10),
		'{"a":1,}',
		"[1,]",
		'{"a":"\\uZZZZ"}',
	])
		expect(() => parseTemplateJson(value)).toThrow();
});
it("enforces exact profile exclusions, strings, safe pins and byte limits", () => {
	for (const key of ["memory", "history", "credentials", "grants", "kind", "botId", "routine", "endpoint"]) {
		const value = doc();
		Object.assign(value.profile, { [key]: "sentinel" });
		expect(() => normalizeTemplate(value)).toThrow();
	}
	for (const instructions of ["\ud800", "\0", "中".repeat(21846), "a".repeat(65537)])
		expect(() => normalizeTemplate({ ...doc(), profile: { ...doc().profile, instructions } })).toThrow();
	expect(
		normalizeTemplate({ ...doc(), profile: { ...doc().profile, instructions: "a".repeat(65536) } }).profile.instructions
			.length,
	).toBe(65536);
	for (const value of [
		{ ...doc(), version: 2 },
		{ ...doc(), extra: true },
		{ ...doc(), profile: { ...doc().profile, name: " " } },
	])
		expect(() => normalizeTemplate(value)).toThrow();
	expect(() => parseTemplateJson(" ".repeat(TEMPLATE_LIMITS.fileBytes) + JSON.stringify(doc()))).toThrow();
	const ref = { name: "report", revision: 1, sha256: "a".repeat(64) };
	expect(() => normalizeTemplate({ ...doc(), profile: { ...doc().profile, defaultSkills: [ref, ref] } })).toThrow();
});
it("binds every skill decision to its source and excludes main-only paths from import parameters", () => {
	const template = normalizeTemplate(doc());
	const choices = { name: "New", model: { kind: "default" }, skills: [] };
	expect(normalizeTemplateChoices(choices, template).name).toBe("New");
	expect(() => normalizeTemplateChoices({ ...choices, model: { kind: "template" } }, template)).toThrow();
	expect(() =>
		normalizeTemplateChoices({ ...choices, skills: [{ name: "forged", choice: { kind: "omit" } }] }, template),
	).toThrow();
	expect(
		paramsError("bots.templates.import", {
			requestId: "not-a-uuid",
			template,
			templateDigest: "a".repeat(64),
			choices,
		}),
	).toBeDefined();
	expect(paramsError("bots.templates.inspect", { template, path: "/private" })).toBeDefined();
	expect(
		validArtifactRequest({
			kind: "artifact.request",
			messageId: "m",
			requestId: "r",
			targetId: "local",
			operation: { action: "template-read", path: "/fixture.json" },
		}),
	).toBe(true);
});

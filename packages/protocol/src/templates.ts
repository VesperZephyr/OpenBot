import { Type } from "typebox";
import { Compile } from "typebox/compile";
import type { GeneratedAvatar } from "./avatars.ts";
import type { ModelRef, ThinkingLevel } from "./index.ts";
import type { SkillRef } from "./skills.ts";

export const TEMPLATE_LIMITS = {
	fileBytes: 1048576,
	ipcBytes: 1064960,
	instructionsBytes: 65536,
	operations: 4,
	receipts: 4096,
} as const;
export type TemplateAvatar = GeneratedAvatar | { kind: "png"; base64: string };
export type BotTemplateV1 = {
	format: "openbot-bot-template";
	version: 1;
	profile: {
		name: string;
		role: string;
		instructions: string;
		avatar: TemplateAvatar;
		model: ModelRef | null;
		thinkingLevel: ThinkingLevel;
		defaultSkills: SkillRef[];
	};
};
export type ModelChoice = { kind: "template" } | { kind: "default" } | { kind: "local"; model: ModelRef };
export type SkillChoice = {
	name: string;
	choice: { kind: "template" } | { kind: "omit" } | { kind: "local"; ref: SkillRef };
};
export type ImportChoices = { name: string; model: ModelChoice; skills: SkillChoice[] };
export type TemplateReview = {
	template: BotTemplateV1;
	templateDigest: string;
	model: { ref: ModelRef | null; state: "available" | "unavailable" };
	skills: { ref: SkillRef; state: "available" | "unavailable" }[];
};
export type ImportResult = { botId: string; state: "active" | "hidden" | "deleted" };
export type TemplateImportInput = {
	requestId: string;
	template: BotTemplateV1;
	templateDigest: string;
	choices: ImportChoices;
};
export type TemplateFile = { name: string; template: BotTemplateV1 };
export const templateObject = <T extends Record<string, import("typebox").TSchema>>(fields: T) =>
	Type.Object(fields, { additionalProperties: false });
const object = templateObject;
const id = Type.String({ minLength: 1, maxLength: 256 });
const name = Type.String({ minLength: 1, maxLength: 200 });
const model = object({ provider: id, modelId: id });
export const TEMPLATE_SHA = Type.String({ pattern: "^[a-f0-9]{64}$" });
export const TEMPLATE_UUID = Type.String({
	pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
});
const skillName = Type.String({ minLength: 1, maxLength: 64, pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" });
const skill = object({
	name: skillName,
	revision: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
	sha256: TEMPLATE_SHA,
});
export const TEMPLATE_SCHEMA = object({
	format: Type.Literal("openbot-bot-template"),
	version: Type.Literal(1),
	profile: object({
		name,
		role: Type.String({ maxLength: 200 }),
		instructions: Type.String({ maxLength: TEMPLATE_LIMITS.instructionsBytes }),
		avatar: Type.Union([
			object({
				kind: Type.Literal("generated"),
				version: Type.Literal(1),
				seed: Type.Integer({ minimum: 0, maximum: 4294967295 }),
				motif: Type.Enum(["leaf", "glasses", "cap"]),
			}),
			object({
				kind: Type.Literal("png"),
				base64: Type.String({
					minLength: 4,
					maxLength: 409600,
					pattern: "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$",
				}),
			}),
		]),
		model: Type.Union([model, Type.Null()]),
		thinkingLevel: Type.Enum(["off", "low", "medium", "high"]),
		defaultSkills: Type.Array(skill, { maxItems: 2 }),
	}),
});
export const TEMPLATE_CHOICES_SCHEMA = object({
	name,
	model: Type.Union([
		object({ kind: Type.Literal("template") }),
		object({ kind: Type.Literal("default") }),
		object({ kind: Type.Literal("local"), model }),
	]),
	skills: Type.Array(
		object({
			name: skillName,
			choice: Type.Union([
				object({ kind: Type.Literal("template") }),
				object({ kind: Type.Literal("omit") }),
				object({ kind: Type.Literal("local"), ref: skill }),
			]),
		}),
		{ maxItems: 2 },
	),
});
export const TEMPLATE_SAVE_SCHEMA = object({
	requestId: TEMPLATE_UUID,
	template: TEMPLATE_SCHEMA,
	templateDigest: TEMPLATE_SHA,
});
let validator: ReturnType<typeof Compile> | undefined, choicesValidator: ReturnType<typeof Compile> | undefined;
const bytes = (s: string) => new TextEncoder().encode(s).length;
function invalid(): never {
	throw new Error("Invalid Bot template or import choices");
}
function strings(value: unknown): boolean {
	if (typeof value === "string") return value.isWellFormed() && !value.includes("\0");
	if (value && typeof value === "object") return Object.values(value).every(strings);
	return true;
}
/** Only call on validated bounded data. Arrays retain order; object key order is portable. */
export function canonicalTemplateJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalTemplateJson).join(",")}]`;
	return `{${Object.keys(value)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalTemplateJson((value as Record<string, unknown>)[key])}`)
		.join(",")}}`;
}
export function normalizeTemplate(value: unknown): BotTemplateV1 {
	if (!(validator ??= Compile(TEMPLATE_SCHEMA)).Check(value) || !strings(value)) invalid();
	const doc = value as BotTemplateV1;
	if (
		!doc.profile.name.trim() ||
		bytes(doc.profile.instructions) > TEMPLATE_LIMITS.instructionsBytes ||
		new Set(doc.profile.defaultSkills.map((ref) => ref.name)).size !== doc.profile.defaultSkills.length
	)
		invalid();
	const result = { ...doc, profile: { ...doc.profile, name: doc.profile.name.trim() } };
	if (bytes(canonicalTemplateJson(result)) >= TEMPLATE_LIMITS.fileBytes) invalid();
	return result;
}
export function normalizeTemplateChoices(value: unknown, template: BotTemplateV1): ImportChoices {
	if (!(choicesValidator ??= Compile(TEMPLATE_CHOICES_SCHEMA)).Check(value) || !strings(value)) invalid();
	const choices = value as ImportChoices;
	if (
		!choices.name.trim() ||
		choices.skills.length !== template.profile.defaultSkills.length ||
		choices.skills.some(
			(entry, i) =>
				entry.name !== template.profile.defaultSkills[i]!.name ||
				(entry.choice.kind === "local" && entry.choice.ref.name !== entry.name),
		) ||
		(choices.model.kind === "template" && !template.profile.model)
	)
		invalid();
	return { ...choices, name: choices.name.trim() };
}
export function templateIpcSize(value: unknown): boolean {
	return bytes(JSON.stringify(value)) <= TEMPLATE_LIMITS.ipcBytes;
}

/** Scan before materializing objects so JSON.parse cannot discard duplicate members. */
export function parseTemplateJson(input: string): BotTemplateV1 {
	if (bytes(input) > TEMPLATE_LIMITS.fileBytes) invalid();
	const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
	let p = 0;
	const ws = () => {
		while (/[\t\n\r ]/.test(text[p] ?? "x")) p++;
	};
	const string = (): string => {
		const start = p++;
		while (p < text.length) {
			const c = text[p++];
			if (c === '"') {
				try {
					return JSON.parse(text.slice(start, p)) as string;
				} catch {
					invalid();
				}
			}
			if (c === "\\") p++;
		}
		return invalid();
	};
	const value = (depth: number): void => {
		if (depth > 8) invalid();
		ws();
		if (text[p] === '"') {
			string();
			return;
		}
		if (text[p] === "{" || text[p] === "[") {
			const obj = text[p++] === "{",
				end = obj ? "}" : "]",
				keys = new Set<string>();
			ws();
			if (text[p] === end) {
				p++;
				return;
			}
			for (;;) {
				ws();
				if (obj) {
					if (text[p] !== '"') invalid();
					const key = string();
					if (keys.has(key)) invalid();
					keys.add(key);
					ws();
					if (text[p++] !== ":") invalid();
				}
				value(depth + 1);
				ws();
				if (text[p] === end) {
					p++;
					return;
				}
				if (text[p++] !== ",") invalid();
			}
		}
		const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(p));
		if (!token) invalid();
		p += token[0].length;
	};
	value(0);
	ws();
	if (p !== text.length) invalid();
	try {
		return normalizeTemplate(JSON.parse(text));
	} catch {
		return invalid();
	}
}
export function templateFilename(name: string): string {
	const clean = name
		.replace(/[\\/\u0000-\u001f\u007f:*?"<>|]/g, "-")
		.replace(/^\.+/, "")
		.trim();
	return `${Array.from(clean).slice(0, 80).join("") || "bot"}.openbot.json`;
}

/** Shared procedures are guidance, never grants or executable extensions. */
export const SKILL_LIMITS = { active: 50, revisions: 1024, receipts: 4096, bytes: 32768, attachments: 2, history: 20 } as const;
export class SkillOperationError extends Error {
	readonly uncertain: boolean;
	constructor(message: string, uncertain = false) {
		super(message);
		this.name = "SkillOperationError";
		this.uncertain = uncertain;
	}
}
export const SKILL_NAME_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*$";
export type SkillDocument = {
	readonly name: string;
	readonly description: string;
	readonly inputs: string;
	readonly requirements: string;
	readonly steps: string;
	readonly validation: string;
	readonly output: string;
	readonly approvalBoundaries: string;
};
export type SkillRef = { readonly name: string; readonly revision: number; readonly sha256: string };
export type SkillSummary = SkillRef & {
	readonly description: string;
	readonly updatedAt: number;
	readonly deleted: boolean;
	readonly available: boolean;
};
export type SkillAttachment = SkillRef & { readonly document: SkillDocument; readonly markdown: string };
export type SkillVersion = SkillSummary & { readonly document: SkillDocument; readonly markdown: string };
export type SkillDetail = { readonly current: SkillVersion; readonly history: readonly SkillSummary[] };
export type SkillChange =
	| { readonly action: "save"; readonly name: string; readonly expectedRevision: number; readonly document: SkillDocument }
	| { readonly action: "delete"; readonly name: string; readonly expectedRevision: number };
export type SkillOperation =
	| { readonly action: "list" }
	| { readonly action: "get"; readonly name: string; readonly revision?: number }
	| SkillChange;
export type SkillResult = readonly SkillSummary[] | SkillDetail | SkillVersion;
const fields = ["name", "description", "inputs", "requirements", "steps", "validation", "output", "approvalBoundaries"] as const;
export function validSkillName(value: unknown): value is string {
	return typeof value === "string" && value.length <= 64 && new RegExp(SKILL_NAME_PATTERN).test(value);
}
export function renderSkill(doc: SkillDocument): string {
	return (
		`---\nname: ${JSON.stringify(doc.name)}\ndescription: ${JSON.stringify(doc.description)}\n---\n\n` +
		[
			["Inputs", doc.inputs],
			["Requirements", doc.requirements],
			["Steps", doc.steps],
			["Validation", doc.validation],
			["Output", doc.output],
			["Approval boundaries", doc.approvalBoundaries],
		]
			.map(([heading, text]) => `## ${heading}\n\n${text}\n`)
			.join("\n")
	);
}
export function validSkillDocument(value: unknown): value is SkillDocument {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const obj = value as Record<string, unknown>;
	if (Object.keys(obj).length !== fields.length || !validSkillName(obj.name)) return false;
	if (
		!fields.every(
			(key) =>
				typeof obj[key] === "string" &&
				(obj[key] as string).isWellFormed() &&
				(obj[key] as string).trim().length > 0 &&
				!(obj[key] as string).includes("\0") &&
				(obj[key] as string).length <= (key === "description" ? 300 : 32768),
		)
	)
		return false;
	return new TextEncoder().encode(renderSkill(value as SkillDocument)).length <= SKILL_LIMITS.bytes;
}
export function validSkillRef(value: unknown): value is SkillRef {
	if (!value || typeof value !== "object") return false;
	const r = value as SkillRef;
	return (
		Object.keys(value).length === 3 &&
		validSkillName(r.name) &&
		Number.isSafeInteger(r.revision) &&
		r.revision > 0 &&
		typeof r.sha256 === "string" &&
		/^[a-f0-9]{64}$/.test(r.sha256)
	);
}
export function validSkillOperation(value: unknown): value is SkillOperation {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const o = value as Record<string, unknown>,
		n = Object.keys(o).length;
	if (o.action === "list") return n === 1;
	if (!validSkillName(o.name)) return false;
	if (o.action === "get")
		return (
			n === (o.revision === undefined ? 2 : 3) &&
			(o.revision === undefined || (Number.isSafeInteger(o.revision) && (o.revision as number) > 0))
		);
	if (!Number.isSafeInteger(o.expectedRevision) || (o.expectedRevision as number) < 0) return false;
	return o.action === "delete" ? n === 3 : o.action === "save" && n === 4 && validSkillDocument(o.document) && o.document.name === o.name;
}

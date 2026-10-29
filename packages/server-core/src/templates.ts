import { createHash, randomUUID } from "node:crypto";
import type { BotRuntime } from "@openbot/agent-runtime";
import {
	canonicalTemplateJson,
	normalizeTemplate,
	normalizeTemplateChoices,
	ProtocolError,
	type BotTemplateV1,
	type TemplateReview,
	type TemplateImportInput,
	type ImportResult,
	type AvatarImage,
	type ArtifactOperation,
	type ArtifactOperationResult,
	type TemplateFile,
	type ModelRef,
	type SkillRef,
} from "@openbot/protocol";
import type { Skills } from "./skills.ts";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const invalid = (): never => {
	throw new ProtocolError("invalid_request", "Review the template and resolve its model and skills before importing");
};
type TemplateOptions = {
	runtime: BotRuntime;
	skills: Skills;
	reloadModels: () => Promise<ReadonlySet<string>>;
	artifact: (id: string, op: ArtifactOperation) => Promise<ArtifactOperationResult>;
	changed: (botId: string) => Promise<void>;
	now: () => number;
};
export class BotTemplates {
	readonly options: TemplateOptions;
	constructor(options: TemplateOptions) {
		this.options = options;
	}
	#normalize(value: unknown) {
		try {
			return normalizeTemplate(value);
		} catch {
			return invalid();
		}
	}
	async #image(template: BotTemplateV1): Promise<AvatarImage | undefined> {
		if (template.profile.avatar.kind !== "png") return undefined;
		try {
			return (await this.options.artifact(randomUUID(), {
				action: "avatar-validate",
				base64: template.profile.avatar.base64,
			})) as AvatarImage;
		} catch {
			throw new ProtocolError("invalid_request", "Could not read this template avatar");
		}
	}
	#modelAvailable(ref: ModelRef | undefined | null, configured: ReadonlySet<string>): boolean {
		return (
			!!ref &&
			configured.has(ref.provider) &&
			this.options.runtime
				.listChatModels()
				.some((m) => m.provider === ref.provider && m.modelId === ref.modelId && !m.provider.startsWith("search:"))
		);
	}
	async #skillAvailable(ref: SkillRef): Promise<boolean> {
		try {
			await this.options.skills.attachments([ref]);
			return true;
		} catch {
			return false;
		}
	}
	async inspect(value: BotTemplateV1): Promise<TemplateReview> {
		const template = this.#normalize(value);
		const [, configured] = await Promise.all([this.#image(template), this.options.reloadModels()]);
		const model = template.profile.model ?? (await this.options.runtime.defaultModel());
		return {
			template,
			templateDigest: hash(canonicalTemplateJson(template)),
			model: {
				ref: template.profile.model,
				state: this.#modelAvailable(model, configured) ? "available" : "unavailable",
			},
			skills: await Promise.all(
				template.profile.defaultSkills.map(async (ref) => ({
					ref,
					state: (await this.#skillAvailable(ref)) ? ("available" as const) : ("unavailable" as const),
				})),
			),
		};
	}
	async export(botId: string, revision: number): Promise<TemplateReview> {
		let template: BotTemplateV1;
		try {
			template = await this.options.runtime.exportTemplate(botId, revision);
		} catch (error) {
			if (error instanceof ProtocolError) throw error;
			throw new ProtocolError("invalid_request", "This profile cannot be exported as a bounded Bot template");
		}
		const image = await this.#image(template);
		if (image)
			template = { ...template, profile: { ...template.profile, avatar: { kind: "png", base64: image.base64 } } };
		return this.inspect(template);
	}
	async import(input: TemplateImportInput): Promise<ImportResult> {
		const template = this.#normalize(input.template);
		let choices;
		try {
			choices = normalizeTemplateChoices(input.choices, template);
		} catch {
			return invalid();
		}
		const templateDigest = hash(canonicalTemplateJson(template));
		if (input.templateDigest !== templateDigest) return invalid();
		const requestDigest = hash(canonicalTemplateJson({ templateDigest, choices }));
		const prior = await this.options.runtime.templateStatus(input.requestId, requestDigest);
		if (prior) return prior;
		const configured = await this.options.reloadModels();
		const model =
			choices.model.kind === "local"
				? choices.model.model
				: choices.model.kind === "template"
					? template.profile.model
					: undefined;
		if (model && !this.#modelAvailable(model, configured)) return invalid();
		const refs = choices.skills.flatMap((entry, i) =>
			entry.choice.kind === "omit"
				? []
				: [entry.choice.kind === "local" ? entry.choice.ref : template.profile.defaultSkills[i]!],
		);
		const image = await this.#image(template);
		try {
			await this.options.skills.attachments(refs);
		} catch {
			return invalid();
		}
		const at = this.options.now(),
			botId = `bot_template_${input.requestId}`;
		const result = await this.options.runtime.importTemplate(
			{
				botId,
				name: choices.name,
				role: template.profile.role,
				instructions: template.profile.instructions,
				thinkingLevel: template.profile.thinkingLevel,
				defaultSkills: refs,
				...(model ? { model } : {}),
				avatar: image
					? { kind: "image", sha256: image.sha256 }
					: (template.profile.avatar as import("@openbot/protocol").GeneratedAvatar),
				createdAt: at,
			},
			{ requestId: input.requestId, requestDigest, botId, committedAt: at },
			image,
		);
		// Reading/notification failure cannot negate the committed receipt.
		try {
			await this.options.changed(result.botId);
		} catch {}
		return result;
	}
	async read(path: string): Promise<TemplateFile> {
		try {
			const result = (await this.options.artifact(randomUUID(), { action: "template-read", path })) as TemplateFile;
			return { name: result.name, template: this.#normalize(result.template) };
		} catch {
			throw new ProtocolError(
				"invalid_request",
				"Could not read this Bot template. Choose a valid template file up to 1 MiB.",
			);
		}
	}
	async write(input: {
		requestId: string;
		path: string;
		template: BotTemplateV1;
		templateDigest: string;
	}): Promise<null> {
		const template = this.#normalize(input.template),
			canonical = canonicalTemplateJson(template);
		if (hash(canonical) !== input.templateDigest) invalid();
		await this.#image(template);
		const utf8 = canonical + "\n";
		try {
			await this.options.artifact(input.requestId, {
				action: "template-write",
				path: input.path,
				utf8,
				sha256: hash(utf8),
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : "";
			if (message === "Export destination already exists. Choose a new filename.")
				throw new ProtocolError("invalid_request", message);
			if (message.includes("different arguments"))
				throw new ProtocolError(
					"request_conflict",
					"This export request was already used for different content or destination",
				);
			// The executor owns publication receipts. Transport or storage failure may follow publication.
			throw new ProtocolError(
				"host_unavailable",
				"Template save result is unconfirmed. Check the selected file before saving again.",
			);
		}
		return null;
	}
}

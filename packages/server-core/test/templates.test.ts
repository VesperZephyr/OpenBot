import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { BotRuntime } from "@openbot/agent-runtime";
import { scriptedModels } from "@openbot/agent-runtime/testing";
import { normalizeTemplate, type SkillRef, type TemplateImportInput } from "@openbot/protocol";
import { BotTemplates } from "../src/templates.ts";
import { HostService, ApprovalBook, MemorySecretStore } from "../src/index.ts";
import { PROTOCOL_VERSION } from "@openbot/protocol";
import type { Skills } from "../src/skills.ts";
let directory: string, runtime: BotRuntime, service: BotTemplates, available: boolean;
const ref: SkillRef = { name: "report", revision: 1, sha256: "a".repeat(64) };
const doc = () =>
	normalizeTemplate({
		format: "openbot-bot-template",
		version: 1,
		profile: {
			name: "Writer",
			role: "",
			instructions: "portable",
			avatar: { kind: "generated", version: 1, seed: 1, motif: "leaf" },
			model: { provider: "missing", modelId: "missing" },
			thinkingLevel: "off",
			defaultSkills: [ref],
		},
	});
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "openbot-template-host-"));
	runtime = await BotRuntime.open({
		databasePath: join(directory, "db"),
		models: scriptedModels().models,
		history: false,
	});
	available = true;
	service = new BotTemplates({
		runtime,
		skills: {
			attachments: async (refs: readonly SkillRef[]) => {
				if (refs.some((r) => !available || r.sha256 !== ref.sha256)) throw Error("unavailable");
				return [];
			},
		} as unknown as Skills,
		reloadModels: async () => new Set(runtime.listChatModels().map((m) => m.provider)),
		artifact: async () => {
			throw Error("unexpected file operation");
		},
		now: () => 1,
		changed: async () => {},
	});
});
afterEach(async () => {
	await runtime.close();
	await rm(directory, { recursive: true, force: true });
});
async function input(): Promise<TemplateImportInput> {
	const review = await service.inspect(doc());
	return {
		requestId: randomUUID(),
		template: review.template,
		templateDigest: review.templateDigest,
		choices: {
			name: "Imported",
			model: { kind: "default" },
			skills: [{ name: ref.name, choice: { kind: "template" } }],
		},
	};
}
it("requires explicit model resolution and exact readable skill pins without provider access", async () => {
	const i = await input();
	expect((await service.inspect(i.template)).model.state).toBe("unavailable");
	await expect(service.import({ ...i, choices: { ...i.choices, model: { kind: "template" } } })).rejects.toThrow(
		"resolve",
	);
	available = false;
	await expect(service.import(i)).rejects.toThrow("resolve");
	expect(await runtime.listBots()).toEqual([]);
	const result = await service.import({
		...i,
		choices: { ...i.choices, skills: [{ name: ref.name, choice: { kind: "omit" } }] },
	});
	expect((await runtime.getBot(result.botId))?.defaultSkills).toEqual([]);
});
it("distinguishes catalogue models from configured models and revalidates explicit local choices", async () => {
	const model = runtime.listChatModels()[0]!;
	const template = {
		...doc(),
		profile: { ...doc().profile, model: { provider: model.provider, modelId: model.modelId }, defaultSkills: [] },
	};
	const review = await service.inspect(template);
	expect(review.model.state).toBe("available");
	const input = {
		requestId: randomUUID(),
		template,
		templateDigest: review.templateDigest,
		choices: { name: "Configured", model: { kind: "local" as const, model: template.profile.model }, skills: [] },
	};
	const created = await service.import(input);
	expect((await runtime.getBot(created.botId))?.model).toEqual(template.profile.model);
	vi.spyOn(service.options, "reloadModels").mockResolvedValue(new Set());
	expect((await service.inspect(template)).model.state).toBe("unavailable");
	await expect(service.import({ ...input, requestId: randomUUID() })).rejects.toThrow("resolve");
	expect(await service.import(input)).toEqual(created);
});
it("replays committed imports before dependency resolution and rejects changed arguments", async () => {
	const i = await input(),
		result = await service.import(i);
	available = false;
	expect(await service.import(i)).toEqual(result);
	expect(await runtime.listBots()).toHaveLength(1);
	await expect(service.import({ ...i, choices: { ...i.choices, name: "Different" } })).rejects.toThrow(
		"different choices",
	);
	const another = await service.import({
		...i,
		requestId: randomUUID(),
		choices: { ...i.choices, skills: [{ name: ref.name, choice: { kind: "omit" } }] },
	});
	expect(another.botId).not.toBe(result.botId);
});
it("preserves a committed result when its notification fails and excludes source state", async () => {
	const i = await input();
	vi.spyOn(service.options, "changed").mockRejectedValue(Error("lost notification"));
	const result = await service.import(i);
	expect(await runtime.templateStatus(i.requestId)).toEqual(result);
	const core = await runtime.ensureCoreBot(1);
	await runtime.setMemory(core.botId, "PRIVATE_MEMORY_SENTINEL", 0);
	const exported = await service.export(core.botId, core.revision);
	expect(exported.template.profile.defaultSkills).toEqual([]);
	expect(JSON.stringify(exported.template)).not.toContain(core.botId);
	expect(JSON.stringify(exported.template)).not.toContain("PRIVATE_MEMORY_SENTINEL");
	await expect(service.import({ ...i, templateDigest: "b".repeat(64) })).rejects.toThrow();
});
it("caps four concurrent operations and excludes template content from diagnostics", async () => {
	const gate = Promise.withResolvers<void>(),
		audit: unknown[] = [];
	const host = new HostService({
		runtime,
		modelConfig: {
			path: "fixture",
			read: async () => undefined,
			write: async () => {},
			environment: { env: () => undefined, run: async () => "" },
		},
		secrets: new MemorySecretStore(),
		approvals: new ApprovalBook(() => {}),
		status: {
			protocolVersion: PROTOCOL_VERSION,
			hostVersion: "test",
			nodeVersion: "test",
			targetId: "local",
			startedAt: 0,
		},
		workspace: directory,
		dataDirectory: directory,
		emit: () => {},
		audit: (event) => audit.push(event),
		artifacts: {
			request: async () => {
				await gate.promise;
				return { name: "PRIVATE_FILENAME.json", template: doc() };
			},
		},
	});
	try {
		const pending = Array.from({ length: 4 }, () =>
			host.handle("templates.file.read", { path: "/PRIVATE_PATH/PRIVATE_FILENAME.json" }),
		);
		await expect(host.handle("bots.templates.status", { requestId: randomUUID() })).rejects.toThrow(
			"Too many template operations",
		);
		gate.resolve();
		await Promise.all(pending);
		expect(await host.handle("bots.templates.status", { requestId: randomUUID() })).toBeNull();
		expect(JSON.stringify(audit)).not.toMatch(/PRIVATE_|portable|Writer|missing/);
	} finally {
		gate.resolve();
		await host.stop();
	}
});

import { ARTIFACT_LIMITS, ProtocolError, type ArtifactContent, type ArtifactRef } from "@openbot/protocol";
import { describe, expect, it } from "vitest";
import { hydrateMessageAttachments, requestArtifact, resolveMessageAttachments, type AttachmentHost } from "../src/host-attachments.ts";

function ref(overrides: Partial<ArtifactRef> = {}): ArtifactRef {
	return {
		artifactId: "a",
		name: "note.txt",
		mediaType: "text/plain",
		bytes: 4,
		sha256: "sha",
		createdAt: 1,
		source: "input",
		availability: "available",
		...overrides,
	};
}

function host(options?: {
	refs?: ArtifactRef[];
	content?: (artifact: ArtifactRef) => ArtifactContent;
	model?: { provider: string; modelId: string };
	defaultModel?: { provider: string; modelId: string };
	images?: boolean;
}) {
	const requests: string[] = [];
	const refs = new Map((options?.refs ?? [ref()]).map((item) => [item.artifactId, item]));
	let defaultModelCalls = 0;
	let listed = 0;
	const attachment: AttachmentHost = {
		request: async (_requestId, operation) => {
			if (operation.action !== "get" && operation.action !== "content") throw new Error(operation.action);
			requests.push(`${operation.action}:${operation.artifactId}`);
			const artifact = refs.get(operation.artifactId) ?? ref({ artifactId: operation.artifactId, availability: "missing" });
			if (operation.action === "get") return artifact;
			return options?.content?.(artifact) ?? { artifact, truncated: false, text: artifact.name };
		},
		liveBot: async () => (options?.model ? { model: options.model } : {}),
		runtime: {
			defaultModel: async () => {
				defaultModelCalls += 1;
				return options?.defaultModel;
			},
			listChatModels: () => {
				listed += 1;
				const model = options?.model ?? options?.defaultModel;
				return model ? [{ provider: model.provider, modelId: model.modelId, images: options?.images ?? false }] : [];
			},
		},
	};
	return { attachment, requests, defaultModelCalls: () => defaultModelCalls, listed: () => listed };
}

describe("message attachments", () => {
	it("rejects a missing store, too many ids, and duplicates before reading", async () => {
		expect(() => requestArtifact(undefined, "r", { action: "get", artifactId: "a" })).toThrow(ProtocolError);
		const calls: string[] = [];
		await expect(requestArtifact({ request: async (_id, operation) => (calls.push(operation.action), ref()) }, "r", { action: "get", artifactId: "a" })).resolves.toMatchObject({ artifactId: "a" });
		expect(calls).toEqual(["get"]);
		const empty = host();
		await expect(resolveMessageAttachments(empty.attachment, "bot", [])).resolves.toEqual([]);
		expect(empty.requests).toEqual([]);
		for (const ids of [["a", "a"], ["a", "b", "c", "d", "e"]]) {
			const sample = host();
			await expect(resolveMessageAttachments(sample.attachment, "bot", ids)).rejects.toMatchObject({ message: "Too many or duplicate attachments" });
			expect(sample.requests).toEqual([]);
		}
	});

	it("stops at the first unavailable file and enforces html, text, and message limits", async () => {
		const missing = host({ refs: [ref({ artifactId: "a" }), ref({ artifactId: "b", availability: "missing" })] });
		await expect(resolveMessageAttachments(missing.attachment, "bot", ["b", "a"])).rejects.toMatchObject({ message: "Attachment content is unavailable" });
		expect(missing.requests).toEqual(["get:b"]);
		const html = host({ refs: [ref({ mediaType: "text/html", bytes: 1 })] });
		const text = host({ refs: [ref({ bytes: ARTIFACT_LIMITS.textBytes + 1 })] });
		const pdf = host({ refs: [ref({ mediaType: "application/pdf", bytes: ARTIFACT_LIMITS.messageBytes + 1 })] });
		for (const sample of [html, text, pdf])
			await expect(resolveMessageAttachments(sample.attachment, "bot", ["a"])).rejects.toMatchObject({ message: "Attachments exceed the message limits" });
	});

	it("accepts images only for the Bot model, falling back to the default model", async () => {
		const image = ref({ mediaType: "image/png", bytes: 10 });
		const unsupported = host({ refs: [image] });
		await expect(resolveMessageAttachments(unsupported.attachment, "bot", ["a"])).rejects.toBeInstanceOf(ProtocolError);
		await expect(resolveMessageAttachments(unsupported.attachment, "bot", ["a"])).rejects.toMatchObject({ message: "This model does not support image attachments" });
		expect(unsupported.listed()).toBe(0);
		const chosen = host({ refs: [image], model: { provider: "p", modelId: "vision" }, images: true });
		await expect(resolveMessageAttachments(chosen.attachment, "bot", ["a"])).resolves.toEqual([image]);
		expect(chosen.defaultModelCalls()).toBe(0);
		const fallback = host({ refs: [image], defaultModel: { provider: "p", modelId: "vision" }, images: false });
		await expect(resolveMessageAttachments(fallback.attachment, "bot", ["a"])).rejects.toMatchObject({ message: "This model does not support image attachments" });
		expect(fallback.defaultModelCalls()).toBe(1);
	});

	it("refuses hydration when bytes changed or the copy is gone, and keeps the accepted order", async () => {
		const changed = host({ refs: [ref({ sha256: "new" })] });
		await expect(hydrateMessageAttachments(changed.attachment, "bot", [ref({ sha256: "old" })])).rejects.toMatchObject({ message: "Attachment content changed" });
		expect(changed.requests).toEqual(["get:a"]);
		const gone = host({
			refs: [ref()],
			content: (artifact) => ({ artifact: { ...artifact, availability: "missing" }, truncated: false }),
		});
		await expect(hydrateMessageAttachments(gone.attachment, "bot", [ref()])).rejects.toMatchObject({ message: "Attachment content is unavailable" });
		const first = ref({ artifactId: "a", name: "a.txt" });
		const second = ref({ artifactId: "b", name: "b.txt" });
		const ready = host({ refs: [first, second] });
		await expect(hydrateMessageAttachments(ready.attachment, "bot", [second, first])).resolves.toEqual([
			{ artifact: second, truncated: false, text: "b.txt" },
			{ artifact: first, truncated: false, text: "a.txt" },
		]);
		expect(ready.requests).toEqual(["get:b", "get:a", "content:b", "content:a"]);
	});
});

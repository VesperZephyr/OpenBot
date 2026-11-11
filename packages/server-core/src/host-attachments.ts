import { randomUUID } from "node:crypto";
import {
	ARTIFACT_LIMITS,
	ProtocolError,
	type ArtifactContent,
	type ArtifactOperation,
	type ArtifactOperationResult,
	type ArtifactRef,
	type ModelRef,
} from "@openbot/protocol";
import type { ArtifactPort } from "./host-ports.ts";

export type AttachmentHost = {
	request(requestId: string, operation: ArtifactOperation): Promise<ArtifactOperationResult>;
	liveBot(botId: string): Promise<{ model?: ModelRef }>;
	runtime: {
		defaultModel(): Promise<ModelRef | undefined>;
		listChatModels(): readonly { provider: string; modelId: string; images: boolean }[];
	};
};

export function requestArtifact(
	artifacts: ArtifactPort | undefined,
	requestId: string,
	operation: ArtifactOperation,
): Promise<ArtifactOperationResult> {
	if (!artifacts) throw new ProtocolError("invalid_request", "Artifact storage is unavailable");
	return artifacts.request(requestId, operation);
}

export async function resolveMessageAttachments(host: AttachmentHost, botId: string, ids: readonly string[]): Promise<ArtifactRef[]> {
	if (ids.length > ARTIFACT_LIMITS.count || new Set(ids).size !== ids.length)
		throw new ProtocolError("invalid_request", "Too many or duplicate attachments");
	const refs: ArtifactRef[] = [];
	for (const artifactId of ids) {
		const ref = (await host.request(randomUUID(), { action: "get", artifactId })) as ArtifactRef;
		if (ref.availability !== "available") throw new ProtocolError("invalid_request", "Attachment content is unavailable");
		refs.push(ref);
	}
	if (
		refs.some((ref) => ref.mediaType === "text/html") ||
		refs.reduce((total, ref) => total + ref.bytes, 0) > ARTIFACT_LIMITS.messageBytes ||
		refs.filter((ref) => ref.mediaType.startsWith("text/")).reduce((total, ref) => total + ref.bytes, 0) > ARTIFACT_LIMITS.textBytes
	)
		throw new ProtocolError("invalid_request", "Attachments exceed the message limits");
	if (refs.some((ref) => ref.mediaType.startsWith("image/"))) {
		const bot = await host.liveBot(botId);
		const model = bot.model ?? (await host.runtime.defaultModel());
		if (!model || !host.runtime.listChatModels().find((item) => item.provider === model.provider && item.modelId === model.modelId)?.images)
			throw new ProtocolError("invalid_request", "This model does not support image attachments");
	}
	return refs;
}

/** Re-read accepted attachments and refuse the Run when their bytes changed or disappeared. */
export async function hydrateMessageAttachments(
	host: AttachmentHost,
	botId: string,
	refs: readonly ArtifactRef[],
): Promise<ArtifactContent[]> {
	const current = await resolveMessageAttachments(
		host,
		botId,
		refs.map((ref) => ref.artifactId),
	);
	if (current.some((ref, index) => ref.sha256 !== refs[index]?.sha256))
		throw new ProtocolError("invalid_request", "Attachment content changed");
	const content: ArtifactContent[] = [];
	for (const ref of refs) {
		const item = (await host.request(randomUUID(), { action: "content", artifactId: ref.artifactId })) as ArtifactContent;
		if (item.artifact.availability !== "available") throw new ProtocolError("invalid_request", "Attachment content is unavailable");
		content.push(item);
	}
	return content;
}

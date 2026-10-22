import { defineDocFamily, type Tx } from "@earendil-works/pi-durable";
import { AVATAR_LIMITS, ProtocolError, type BotAvatar, type AvatarImage } from "@openbot/protocol";
import type { BotRecord } from "./bots.ts";

export const AvatarDoc = defineDocFamily<{ base64: string }, null>({
	family: true,
	kind: "openbot.avatar",
	version: 1,
	scope: "session",
	initial: () => ({ base64: "" }),
});

/** Commit artwork with its profile. No unreferenced picker uploads are persisted. */
export async function saveAvatar(
	tx: Tx,
	bots: Record<string, BotRecord>,
	avatar: BotAvatar,
	image?: AvatarImage,
	replacingBotId?: string,
): Promise<void> {
	if (avatar.kind !== "image") return;
	const references = new Set(
		Object.values(bots)
			.filter((bot) => bot.botId !== replacingBotId)
			.flatMap((bot) => (bot.avatar?.kind === "image" ? [bot.avatar.sha256] : [])),
	);
	if (!references.has(avatar.sha256) && references.size >= AVATAR_LIMITS.images)
		throw new ProtocolError(
			"invalid_request",
			"Avatar storage is full. Replace an uploaded avatar with a generated one first.",
		);
	const doc = await tx.doc(AvatarDoc, avatar.sha256, null);
	if (image) {
		if (image.sha256 !== avatar.sha256 || image.base64.length > Math.ceil(AVATAR_LIMITS.pngBytes / 3) * 4)
			throw new ProtocolError("invalid_request", "Invalid avatar image");
		doc.base64 = image.base64;
	} else if (!doc.base64) throw new ProtocolError("invalid_request", "Avatar image is unavailable. Upload it again.");
}
export async function releaseAvatar(
	tx: Tx,
	bots: Record<string, BotRecord>,
	old: BotAvatar | undefined,
): Promise<void> {
	if (
		old?.kind === "image" &&
		!Object.values(bots).some((bot) => bot.avatar?.kind === "image" && bot.avatar.sha256 === old.sha256)
	)
		(await tx.doc(AvatarDoc, old.sha256, null)).base64 = "";
}

/** Identity artwork is local presentation data, never model context or authority. */
export type GeneratedAvatar = {
	readonly kind: "generated";
	readonly version: 1;
	readonly seed: number;
	readonly motif: "leaf" | "glasses" | "cap";
};
export type BotAvatar = GeneratedAvatar | { readonly kind: "image"; readonly sha256: string };
export type AvatarUpload = { readonly kind: "upload"; readonly base64: string };
export type AvatarChange = GeneratedAvatar | AvatarUpload;
export type AvatarImage = { readonly sha256: string; readonly base64: string };
export type AvatarSource = { readonly base64: string; readonly mediaType: "image/png" | "image/jpeg" | "image/webp" };
export const AVATAR_LIMITS = {
	sourceBytes: 5 * 1024 * 1024,
	side: 4096,
	pixels: 16_000_000,
	size: 256,
	pngBytes: 300 * 1024,
	images: 128,
} as const;
/** V1 remains stable across rename, role changes, restart and renderer updates. */
export function defaultAvatar(botId: string): GeneratedAvatar {
	let seed = 2166136261;
	for (const char of botId) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
	return { kind: "generated", version: 1, seed, motif: "leaf" };
}
export function avatarMotif(role: string): GeneratedAvatar["motif"] {
	return /research|analyst|scout|review|研究|分析/i.test(role)
		? "glasses"
		: /writ|edit|scribe|design|写作|编辑|设计/i.test(role)
			? "cap"
			: "leaf";
}

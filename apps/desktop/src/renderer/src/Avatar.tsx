import { useEffect, useState } from "react";
import {
	defaultAvatar,
	type BotAvatar,
	type BotProfile,
	type AvatarUpload,
	type GeneratedAvatar,
} from "@openbot/protocol";
import { api, useStore } from "./store";
import { t } from "./i18n";

const AVATAR_PALETTES = [
	["#b794f6", "#3b2760", "#f6e27a"],
	["#5cbf86", "#1a4332", "#f3c56a"],
	["#f0a15a", "#6a341f", "#d7c0f2"],
	["#6aade8", "#1d3550", "#e6e07a"],
	["#f09ab8", "#6a3044", "#c9e09a"],
	["#d0d25a", "#3c461c", "#dcc6ee"],
] as const;

/** V1 color slot. `seed % 6` is the stable mapping; paint may change, this index may not. */
export function avatarColorIndex(seed: number): number {
	return (seed >>> 0) % 6;
}
function avatarShape(seed: number): 0 | 1 | 2 {
	return (Math.floor((seed >>> 0) / 6) % 3) as 0 | 1 | 2;
}

const images = new Map<string, Promise<string | undefined>>();
function imageFor(botId: string, sha256: string): Promise<string | undefined> {
	let pending = images.get(sha256);
	if (!pending) {
		pending = api["bots.avatar.get"]({ botId })
			.then((image) => (image?.sha256 === sha256 ? `data:image/png;base64,${image.base64}` : undefined))
			.catch(() => undefined);
		images.set(sha256, pending);
		void pending.then((value) => {
			if (!value) images.delete(sha256);
		});
		if (images.size > 128) images.delete(images.keys().next().value!);
	}
	return pending;
}
/** One identity renderer for roster, transcript, group authors and profile previews. */
export function Avatar({
	bot,
	size = 34,
	value,
}: {
	bot: Pick<BotProfile, "botId" | "avatar">;
	size?: number;
	value?: BotAvatar | AvatarUpload;
}) {
	const selected = value ?? bot.avatar ?? defaultAvatar(bot.botId);
	const sha256 = selected.kind === "image" ? selected.sha256 : undefined;
	const [loaded, setLoaded] = useState<{ sha256: string; url: string }>();
	const [broken, setBroken] = useState<string>();
	useEffect(() => {
		let current = true;
		if (sha256)
			void imageFor(bot.botId, sha256).then((url) => {
				if (current && url) setLoaded({ sha256, url });
			});
		return () => {
			current = false;
		};
	}, [bot.botId, sha256]);
	const url =
		selected.kind === "upload"
			? `data:image/png;base64,${selected.base64}`
			: loaded?.sha256 === sha256
				? loaded?.url
				: undefined;
	return (
		<span className="avatar" style={{ width: size, height: size }} aria-hidden="true" data-avatar-kind={selected.kind}>
			{url && broken !== url ? (
				<img src={url} alt="" draggable={false} onError={() => setBroken(url)} />
			) : (
				<Character recipe={selected.kind === "generated" ? selected : defaultAvatar(bot.botId)} />
			)}
		</span>
	);
}

export function PersonalStar() {
	return (
		<span
			className="personal-star"
			role="img"
			aria-label={t("Personal assistant")}
			title={t("Your personal assistant")}
		>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<path d="m12 2 3 6.1 6.7 1-4.8 4.7 1.1 6.6-6-3.1-6 3.1 1.1-6.6-4.8-4.7 6.7-1Z" />
			</svg>
		</span>
	);
}

/** V1 geometry. Only saturation, solid fill and a light highlight change. */
function Character({ recipe }: { recipe: GeneratedAvatar }) {
	const n = recipe.seed >>> 0;
	const colorIndex = avatarColorIndex(n);
	const shape = avatarShape(n);
	const [body, ink, accent] = AVATAR_PALETTES[colorIndex]!;
	const bodyShape =
		shape === 0 ? (
			<path d="M37 31C56 10 99 12 117 35c16 22 18 59 2 83-13 21-40 27-62 20-28-8-39-34-36-61 1-19 6-35 16-46Z" />
		) : shape === 1 ? (
			<rect x="24" y="24" width="104" height="116" rx="37" />
		) : (
			<path d="M26 59 38 25l31 10c12-3 23-3 34 0l22-9 3 40c10 35-5 70-39 76-34 6-66-9-68-44-1-15 1-29 5-39Z" />
		);
	return (
		<svg viewBox="0 0 150 165" fill="none" aria-hidden="true">
			<g fill={body} stroke={ink} strokeWidth="2.4">
				{bodyShape}
			</g>
			<ellipse cx="58" cy="48" rx="14" ry="8" fill="#ffffff" opacity="0.28" />
			<g fill={ink}>
				<ellipse cx="57" cy="78" rx="5" ry="8" />
				<ellipse cx="96" cy="78" rx="5" ry="8" />
			</g>
			{recipe.motif === "glasses" ? (
				<g stroke={ink} strokeWidth="2">
					<circle cx="57" cy="78" r="15" />
					<circle cx="96" cy="78" r="15" />
					<path d="M72 78h9" />
				</g>
			) : recipe.motif === "cap" ? (
				<path d="M43 38c10-18 40-22 62-10l-6 14H43Z" fill={accent} stroke={ink} strokeWidth="1.5" />
			) : (
				<path d="M76 26C74 10 88 5 101 11c-2 12-12 18-25 15Z" fill={accent} stroke={ink} strokeWidth="1.5" />
			)}
			<path
				d={Math.floor(n / 18) % 2 ? "M66 105h17" : "M64 101c8 9 17 8 24-1"}
				stroke={ink}
				strokeWidth="2.2"
				strokeLinecap="round"
			/>
			<path d="m48 136-5 15m58-14 6 13" stroke={ink} strokeWidth="2" strokeLinecap="round" />
		</svg>
	);
}

/** Overlapping member identities for an empty conversation. */
export function AvatarStack({ bots, size = 72 }: { readonly bots: readonly Pick<BotProfile, "botId" | "avatar">[]; readonly size?: number }) {
	const shown = bots.slice(0, 3);
	return (
		<span className="avatar-stack" aria-hidden="true">
			{shown.map((bot, index) => (
				<span key={bot.botId} className="avatar-stack-item" style={{ zIndex: shown.length - index }}>
					<Avatar bot={bot} size={size} />
				</span>
			))}
		</span>
	);
}

/** Group identity is composed from existing member identities, never a second Bot. */
export function GroupAvatar({ memberIds }: { memberIds: readonly string[] }) {
    const bots = useStore(state => state.bots);
    return <span className="group-avatar" role="img" aria-label={t("Group · {count} members", {count: memberIds.length})}>
        {memberIds.slice(0, 4).map(botId => <Avatar key={botId} bot={bots.find(bot => bot.botId === botId) ?? {botId}} size={23} />)}
    </span>;
}

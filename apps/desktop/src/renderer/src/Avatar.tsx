import { useEffect, useState } from "react";
import {
	defaultAvatar,
	type BotAvatar,
	type BotProfile,
	type AvatarUpload,
	type GeneratedAvatar,
} from "@openbot/protocol";
import { api } from "./store";
import { t } from "./i18n";

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

/** Original V1 artwork: retain geometry and palettes for existing saved recipes. */
function Character({ recipe }: { recipe: GeneratedAvatar }) {
	const palettes = [
		["#ded1ee", "#534060", "#eee8b5"],
		["#d5e8dc", "#385d4c", "#eed5ad"],
		["#f2dac2", "#78523d", "#e4d5ef"],
		["#d4e3ef", "#3b5269", "#e8e7b5"],
		["#eed7e1", "#714757", "#d9e7c0"],
		["#e3e5bf", "#555d35", "#e4d8ee"],
	];
	const n = recipe.seed,
		[body, ink, accent] = palettes[n % 6]!,
		shape = Math.floor(n / 6) % 3;
	return (
		<svg viewBox="0 0 150 165" fill="none" aria-hidden="true">
			<g fill={body} stroke={ink} strokeWidth="1.8">
				{shape === 0 ? (
					<path d="M37 31C56 10 99 12 117 35c16 22 18 59 2 83-13 21-40 27-62 20-28-8-39-34-36-61 1-19 6-35 16-46Z" />
				) : shape === 1 ? (
					<rect x="24" y="24" width="104" height="116" rx="37" />
				) : (
					<path d="M26 59 38 25l31 10c12-3 23-3 34 0l22-9 3 40c10 35-5 70-39 76-34 6-66-9-68-44-1-15 1-29 5-39Z" />
				)}
			</g>
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

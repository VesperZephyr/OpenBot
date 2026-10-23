import { useEffect, useRef, useState } from "react";
import {
	avatarMotif,
	defaultAvatar,
	type AvatarChange,
	type BotProfile,
	type GeneratedAvatar,
} from "@openbot/protocol";
import { Avatar } from "./Avatar";
import { t } from "./i18n";
import { errorMessage } from "./store";

export function AvatarEditor({
	bot,
	role,
	value,
	onChange,
	disabled,
}: {
	bot: BotProfile;
	role: string;
	value: AvatarChange | undefined;
	onChange: (value: AvatarChange) => void;
	disabled: boolean;
}) {
	const [options, setOptions] = useState<GeneratedAvatar[]>([]),
		[error, setError] = useState(""),
		[loading, setLoading] = useState(false);
	const generation = useRef(0),
		round = useRef(0);
	useEffect(
		() => () => {
			generation.current++;
		},
		[],
	);
	const generate = () => {
		const base =
			((bot.avatar?.kind === "generated" ? bot.avatar.seed : defaultAvatar(bot.botId).seed) + ++round.current * 37) >>>
			0;
		setOptions(
			Array.from({ length: 6 }, (_, i) => ({
				kind: "generated",
				version: 1,
				seed: (base + i * 7) >>> 0,
				motif: avatarMotif(role),
			})),
		);
	};
	const upload = async () => {
		const id = ++generation.current;
		setLoading(true);
		setError("");
		try {
			const picked = await window.openbot.pickAvatar();
			if (id === generation.current && picked) onChange(picked);
		} catch (error) {
			if (id === generation.current) setError(errorMessage(error));
		} finally {
			if (id === generation.current) setLoading(false);
		}
	};
	return (
		<section className="avatar-editor" aria-label={t("Avatar options")}>
			<div className="avatar-stage">
				<Avatar bot={bot} size={112} {...(value ? { value } : {})} />
			</div>
			<span className="avatar-caption">{t("Make this Bot your own")}</span>
			{!!options.length && (
				<div className="avatar-candidates" role="group" aria-label={t("Generated avatar choices")}>
					{options.map((option, i) => (
						<button
							key={option.seed}
							type="button"
							className="avatar-choice"
							disabled={disabled || loading}
							aria-label={t("Avatar option {number}", { number: i + 1 })}
							aria-pressed={value?.kind === "generated" && value.seed === option.seed && value.motif === option.motif}
							onClick={() => {
								generation.current++;
								onChange(option);
								setError("");
							}}
						>
							<Avatar bot={bot} size={44} value={option} />
						</button>
					))}
				</div>
			)}
			<button type="button" disabled={disabled || loading} onClick={generate}>
				{t(options.length ? "Another set" : "Generate options")}
			</button>
			<button type="button" disabled={disabled || loading} onClick={() => void upload()}>
				{t(loading ? "Reading image…" : "Upload image")}
			</button>
			<small>{t("PNG, JPEG or WebP · Up to 5 MB")}</small>
			<small>{t("Centered crop. Saved only with your profile.")}</small>
			{error && <p role="alert">{t(error)}</p>}
		</section>
	);
}

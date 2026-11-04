/** Shared transition durations. `installMotion` publishes them as `--motion-*`. Reduced motion sets every duration to 0. */
export const motionMs = {
	panel: 200,
	menu: 150,
	message: 180,
} as const;

/** Working-avatar breathe. A cycle, not a transition, so it is outside the 200ms cap. */
export const breatheMs = 2400;

export type MotionName = keyof typeof motionMs;

export function motionDuration(name: MotionName, reduced: boolean): string {
	return reduced ? "0ms" : `${motionMs[name]}ms`;
}

export function motionRules(): string {
	const block = (reduced: boolean) =>
		[
			...(Object.keys(motionMs) as MotionName[]).map((name) => `--motion-${name}:${motionDuration(name, reduced)}`),
			`--motion-breathe:${reduced ? "0ms" : `${breatheMs}ms`}`,
		].join(";");
	return `:root{${block(false)}}@media (prefers-reduced-motion: reduce){:root{${block(true)}}}`;
}

export function installMotion(): void {
	if (typeof document === "undefined") return;
	const found = document.head.querySelector("style[data-openbot-motion]");
	const style = found instanceof HTMLStyleElement ? found : document.head.appendChild(document.createElement("style"));
	style.dataset.openbotMotion = "";
	style.textContent = motionRules();
}

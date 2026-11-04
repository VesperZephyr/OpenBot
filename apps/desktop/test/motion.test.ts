import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { chinese, presentError, translate } from "../src/shared/i18n";
import { breatheMs, motionDuration, motionMs, motionRules } from "../src/renderer/src/ui/motion";

const root = dirname(fileURLToPath(import.meta.url));
const styles = readFileSync(join(root, "../src/renderer/src/styles.css"), "utf8");

function channels(hex: string) {
	const n = Number.parseInt(hex.slice(1), 16);
	return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function luminance(hex: string) {
	return [channels(hex).r, channels(hex).g, channels(hex).b]
		.map((channel) => channel / 255)
		.map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
		.reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!, 0);
}

function contrast(foreground: string, background: string) {
	const a = luminance(foreground);
	const b = luminance(background);
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function token(block: string, name: string) {
	const match = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
	if (!match?.[1]) throw new Error(`Missing ${name}`);
	return match[1];
}

describe("motion tokens", () => {
	it("keeps panel, menu and message durations, and reduces all of them to zero", () => {
		expect(motionMs).toEqual({ panel: 200, menu: 150, message: 180 });
		expect(motionDuration("panel", false)).toBe("200ms");
		expect(motionDuration("menu", false)).toBe("150ms");
		expect(motionDuration("message", false)).toBe("180ms");
		expect(motionDuration("panel", true)).toBe("0ms");
		expect(motionDuration("menu", true)).toBe("0ms");
		expect(motionDuration("message", true)).toBe("0ms");
		expect(breatheMs).toBe(2400);
		expect(motionRules()).toContain("--motion-breathe:2400ms");
		expect(motionRules()).toContain("@media (prefers-reduced-motion: reduce){:root{--motion-panel:0ms;--motion-menu:0ms;--motion-message:0ms;--motion-breathe:0ms}}");
		expect(styles).toContain("var(--motion-panel)");
		expect(styles).toContain("var(--motion-menu)");
		expect(styles).toContain("var(--motion-message)");
	});

	it("keeps accent text and status colors above 4.5:1 and has no allow-all copy", () => {
		const light = styles.slice(styles.indexOf(":root {"), styles.indexOf(':root[data-theme="dark"]'));
		const dark = styles.slice(styles.indexOf(':root[data-theme="dark"]'));
		expect(contrast(token(light, "--accent-text"), token(light, "--surface"))).toBeGreaterThanOrEqual(4.5);
		expect(contrast(token(dark, "--accent-text"), token(dark, "--surface"))).toBeGreaterThanOrEqual(4.5);
		expect(contrast("#ffffff", token(light, "--accent"))).toBeGreaterThanOrEqual(4.5);
		expect(contrast("#ffffff", token(dark, "--accent"))).toBeGreaterThanOrEqual(4.5);
		expect(token(light, "--danger")).toBe("#b42318");
		expect(token(dark, "--danger")).toBe("#fecdd3");
		expect(token(light, "--ready")).toBe("#3f6212");
		expect(Object.keys(chinese).join("\n")).not.toMatch(/allow all/i);
		expect(Object.values(chinese).join("\n")).not.toContain("全部放行");
	});

	it("shows executor failures in everyday language", () => {
		expect(presentError("Could not start the local executor: ENOENT")).toBe("The local runtime failed to start");
		expect(presentError("The local executor did not become ready in time")).toBe("The local runtime did not become ready in time");
		expect(presentError("The local executor timed out before reporting a result; the action may have partly run")).toBe(
			"The operation timed out. The result is unknown and may have partly run.",
		);
		expect(translate("zh-CN", "Could not start the local executor: EACCES")).toBe("本地运行环境启动失败");
		expect(translate("zh-CN", "The local executor did not become ready in time")).toBe("本地运行环境没有及时就绪");
		expect(translate("zh-CN", "The local executor timed out before reporting a result; the action may have partly run")).toBe(
			"操作超时，结果未知，可能已部分执行",
		);
		expect(translate("en", "Keep this unrelated error")).toBe("Keep this unrelated error");
	});
});

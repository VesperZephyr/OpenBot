import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { translate } from "../src/shared/i18n";

const language = vi.hoisted(() => ({ value: "en" as "en" | "zh-CN" }));

vi.mock("../src/renderer/src/store", () => ({
	useStore: {
		getState: () => ({ settings: { language: language.value } }),
	},
}));

const { ProfileConflictNotice, profileConflictExplanation } = await import("../src/renderer/src/features/details/profile-conflict");

function notice(reload: () => void, keepEditing: () => void): string {
	return renderToStaticMarkup(createElement(ProfileConflictNotice, { onReload: reload, onKeepEditing: keepEditing }));
}

function alertButtons(html: string): string[] {
	const alert = html.match(/<div class="identity-alert" role="alert">([\s\S]*)<\/div>/)?.[1] ?? "";
	return [...alert.matchAll(/<button type="button">([^<]*)<\/button>/g)].map((match) => match[1] ?? "");
}

describe("profile conflict notice", () => {
	it("says this Bot was just changed elsewhere and keeps reload and continue editing", () => {
		expect(profileConflictExplanation).toBe("This Bot was just changed elsewhere.");
		expect(translate("en", profileConflictExplanation)).toBe("This Bot was just changed elsewhere.");
		expect(translate("zh-CN", profileConflictExplanation)).toBe("这个 Bot 刚在别处改过");
		expect(translate("zh-CN", "Reload profile")).toBe("重新加载资料");
		expect(translate("zh-CN", "Keep editing")).toBe("继续编辑");

		const reload = vi.fn();
		const keepEditing = vi.fn();
		language.value = "en";
		const english = notice(reload, keepEditing);
		expect(english).toContain("This Bot was just changed elsewhere.");
		expect(alertButtons(english)).toEqual(["Reload profile", "Keep editing"]);

		language.value = "zh-CN";
		const chinese = notice(reload, keepEditing);
		expect(chinese).toContain("这个 Bot 刚在别处改过");
		expect(alertButtons(chinese)).toEqual(["重新加载资料", "继续编辑"]);
		expect(chinese).not.toContain("Reload profile");
		expect(chinese).not.toContain("Keep editing");
	});
});

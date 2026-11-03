/** B10: exact skill review, shared reuse and immutable queued input on the hidden desktop. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { launchApp, type AppHarness } from "./harness.ts";
let h: AppHarness, core: string, second: string, ref: any;
const doc = {
	name: "sales-report",
	description: "Summarize sales",
	inputs: "Numbers supplied by the user",
	requirements: "None",
	steps: "B10_METHOD_CANARY: sum the numbers and write report.txt",
	validation: "Check the sum",
	output: "Publish report.txt",
	approvalBoundaries: "Never bypass a denied tool",
};
const poll = (fn: () => Promise<any>) => expect.poll(fn, { timeout: 15000 });
const snapshot = (botId = core) => h.api("conversations.snapshot", { botId });
const box = () => h.page().locator(".compose-area textarea");
const send = async (text: string) => {
	await box().fill(text);
	await box().press("Enter");
};
beforeAll(async () => {
	h = await launchApp("skills");
	h.page().setDefaultTimeout(10000);
	await h.api("settings.update", { defaultModel: { provider: "scripted", modelId: "scripted" } });
	core = (await h.api("bots.list")).find((b: any) => b.kind === "core").botId;
});
afterEach(async ({ task }) => {
	if (task.result?.state === "fail") await h.shot("failure");
});
afterAll(async () => {
	await h?.close();
});
it("reviews a proposed method, denies without saving and approves a distinct proposal once", async () => {
	h.model.script(
		{ tool: "local_write", args: { path: "report.txt", content: "Total: 7" } },
		{ tool: "artifact_publish", args: { path: "report.txt" } },
		{ tool: "skill_save", args: { action: "save", name: doc.name, expectedRevision: 0, document: doc } },
		{ text: "The procedure was not saved." },
	);
	await send("Report 3 + 4 and propose saving the method.");
	await poll(async () => (await snapshot()).approvals[0]?.tool).toBe("skill_save");
	expect(await h.page().locator(".approval .skill-review").textContent()).toContain("B10_METHOD_CANARY");
	expect(await h.page().locator(".approval").getByText("Always allow", { exact: true }).count()).toBe(0);
	await h.shot("01-review-en");
	await h.page().locator(".approval").getByRole("button", { name: "Deny", exact: true }).click();
	await h.page().getByText("The procedure was not saved.", { exact: true }).waitFor();
	expect(await h.api("skills.list")).toEqual([]);
	h.model.script(
		{ tool: "skill_save", args: { action: "save", name: doc.name, expectedRevision: 0, document: doc } },
		{ text: "The reviewed procedure is saved." },
	);
	await send("Save the proposed procedure now.");
	await poll(async () => (await snapshot()).approvals[0]?.tool).toBe("skill_save");
	await h.page().locator(".approval").getByRole("button", { name: "Allow once", exact: true }).click();
	await h.page().getByText("The reviewed procedure is saved.", { exact: true }).waitFor();
	ref = (await h.api("skills.list"))[0];
	expect(ref.revision).toBe(1);
	expect((await h.api("skills.get", { name: doc.name })).history).toHaveLength(1);
	expect(await readFile(join(h.dataDirectory, "skills", doc.name, "SKILL.md"), "utf8")).toContain("B10_METHOD_CANARY");
	await h.page().getByRole("button", { name: /^Settings/ }).click();
	await h.page().getByRole("button", { name: "Skills", exact: true }).click();
	await h
		.page()
		.getByRole("button", { name: /sales-report/ })
		.click();
	await h.page().getByRole("button", { name: "Edit skill", exact: true }).waitFor();
	await h.shot("02-library-en");
});
it("loads from another Bot after restart without changing command policy and produces a result", async () => {
	second = (await h.api("bots.create", { requestId: "b10-second", name: "Analyst" })).botId;
	await h.relaunch();
	await h
		.page()
		.getByRole("button", { name: /Analyst/ })
		.click();
	await h.api("policy.update", { commandSetting: "never" });
	h.model.script(
		{ tool: "skill_load", args: { name: ref.name, revision: ref.revision, sha256: ref.sha256 } },
		{ tool: "local_exec", args: { command: "touch forbidden.txt", description: "Forbidden command" } },
		{ tool: "local_write", args: { path: "report.txt", content: "Total: 13" } },
		{ tool: "artifact_publish", args: { path: "report.txt" } },
		{ text: "Used the reviewed method. Total: 13." },
	);
	await send("Use sales-report for 6 + 7. Respect the disabled command policy.");
	await h.page().getByText("Used the reviewed method. Total: 13.", { exact: true }).waitFor();
	const items = (await snapshot(second)).items;
	expect(items.find((i: any) => i.tool === "skill_load").status).toBe("succeeded");
	expect(items.find((i: any) => i.tool === "local_exec").status).toBe("failed");
	expect(await readFile(join(h.workspace, "forbidden.txt"), "utf8").catch(() => null)).toBeNull();
	const result = items.find((i: any) => i.tool === "artifact_publish").artifact;
	expect((await h.api("artifacts.preview", { artifactId: result.artifactId })).text).toBe("Total: 13");
});
it("pins slash-selected versions across draft reload, queue, deletion and restart", async () => {
	await h.api("lifecycle.pause");
	await poll(async () => (await h.api("lifecycle.get")).transitioning).toBe(false);
	await box().fill("/sales");
	await h
		.page()
		.getByRole("option", { name: /sales-report/ })
		.waitFor();
	await box().press("Enter");
	expect(await box().inputValue()).toBe("");
	expect(await h.page().locator(".composer .skill-chip").count()).toBe(1);
	await box().fill("Reuse the exact selected method with 8 + 9.");
	await h.page().reload();
	await h
		.page()
		.getByRole("button", { name: /Analyst/ })
		.click();
	await poll(() => h.page().locator(".composer .skill-chip").count()).toBe(1);
	await box().press("Enter");
	await poll(async () => (await snapshot(second)).run?.state).toBe("queued");
	// Library edits are blocked while paused. Resume admission after a bounded unrelated edit during a queued slot is covered by Run tests.
	await h.relaunch();
	await h
		.page()
		.getByRole("button", { name: /Analyst/ })
		.click();
	h.model.script({ text: "Pinned method retained." });
	await h.api("lifecycle.resume");
	await h.page().getByText("Pinned method retained.", { exact: true }).waitFor();
	const user = (await snapshot(second)).items.filter((i: any) => i.kind === "user").at(-1);
	expect(user.skills).toEqual([{ name: ref.name, revision: 1, sha256: ref.sha256 }]);
	const chip = h.page().locator(".message-user .skill-chip").last();
	await chip.waitFor();
	// Computed colors are not always rgb(n, n, n): a transparent chip serializes as
	// `transparent` or `rgb(none none none / none)`, which has no digits. Measure the
	// painted pair, compositing a transparent fill over the bubble behind it.
	const contrast = await chip.evaluate((element) => {
		const parsed = (raw: string) => {
			const value = raw.trim().toLowerCase();
			if (!value || value === "transparent" || (value.includes("none") && !/\d/.test(value))) return { r: 0, g: 0, b: 0, a: 0 };
			const hex = /^#([0-9a-f]{3,8})$/.exec(value);
			if (hex) {
				const body = hex[1]!.length === 3 ? [...hex[1]!].map((c) => c + c).join("") : hex[1]!;
				const r = parseInt(body.slice(0, 2), 16), g = parseInt(body.slice(2, 4), 16), b = parseInt(body.slice(4, 6), 16);
				const a = body.length >= 8 ? parseInt(body.slice(6, 8), 16) / 255 : 1;
				return { r, g, b, a };
			}
			const nums = value.match(/[\d.]+/g)?.map(Number);
			if (!nums || nums.length < 3) return null;
			const scale = value.startsWith("color(") && nums.slice(0, 3).every((n) => n <= 1) ? 255 : 1;
			const alpha = nums.length > 3 ? (nums[3]! > 1 ? nums[3]! / 255 : nums[3]!) : 1;
			return { r: nums[0]! * scale, g: nums[1]! * scale, b: nums[2]! * scale, a: alpha };
		};
		const paint = (node: Element): { r: number; g: number; b: number; a: number } => {
			const start = parsed(getComputedStyle(node).backgroundColor);
			if (!start) throw new Error(`Unparseable background: ${getComputedStyle(node).backgroundColor}`);
			let layer: { r: number; g: number; b: number; a: number } = start;
			let parent = node.parentElement;
			while (layer.a < 1 && parent) {
				const under = parsed(getComputedStyle(parent).backgroundColor);
				if (!under) throw new Error(`Unparseable background: ${getComputedStyle(parent).backgroundColor}`);
				const above = layer.a;
				const cover = above + under.a * (1 - above);
				const mix = (front: number, back: number): number => (cover === 0 ? 0 : (front * above + back * under.a * (1 - above)) / cover);
				layer = { r: mix(layer.r, under.r), g: mix(layer.g, under.g), b: mix(layer.b, under.b), a: cover };
				parent = parent.parentElement;
			}
			return layer;
		};
		const luminance = (color: { r: number; g: number; b: number }) =>
			[color.r, color.g, color.b]
				.map((n) => n / 255)
				.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
				.reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
		const foreground = parsed(getComputedStyle(element).color);
		if (!foreground) throw new Error(`Unparseable color: ${getComputedStyle(element).color}`);
		const background = paint(element);
		const a = luminance(foreground), b = luminance(background);
		return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
	});
	expect(contrast).toBeGreaterThanOrEqual(4.5);
	await h.shot("05-attached-skill-en");
	expect(JSON.stringify(h.model.requests.at(-1)?.messages)).toContain("B10_METHOD_CANARY");
	const updated = await h.api("skills.save", {
		requestId: "b10-edit",
		name: doc.name,
		expectedRevision: 1,
		document: { ...doc, steps: "New procedure" },
	});
	expect(updated.revision).toBe(2);
	await expect(h.api("skills.save", { requestId: "stale", name: doc.name, expectedRevision: 1, document: doc })).rejects.toThrow(/changed/);
	await h.api("skills.delete", { requestId: "b10-delete", name: doc.name, expectedRevision: 2 });
	await h.relaunch();
	await h
		.page()
		.getByRole("button", { name: /Analyst/ })
		.click();
	expect((await snapshot(second)).items.filter((i: any) => i.kind === "user").at(-1).skills[0].revision).toBe(1);
	await h.api("settings.update", { language: "zh-CN" });
	await h.page().getByRole("button", { name: /^设置/ }).click();
	await h.page().getByRole("button", { name: "技能", exact: true }).click();
	await h
		.page()
		.getByRole("button", { name: /sales-report/ })
		.click();
	await h.page().getByRole("button", { name: "恢复为新版本", exact: true }).waitFor();
	await h.shot("03-library-zh");
	expect(await h.app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every((w) => !w.isVisible() && !w.isFocused()))).toBe(
		true,
	);
	const log = await readFile(join(h.dataDirectory, "logs/host.log"), "utf8");
	expect(log).not.toContain("B10_METHOD_CANARY");
});
it("edits through review, rejects a stale editor and confirms deletion in the library", async () => {
	await h.api("settings.update", { language: "en" });
	await h.page().getByRole("button", { name: "Restore as new version", exact: true }).click();
	await h.page().getByLabel("Steps", { exact: true }).fill("Restored procedure");
	await h.page().getByRole("button", { name: "Review changes", exact: true }).click();
	expect((await h.api("skills.get", { name: doc.name })).current.revision).toBe(3);
	await h.page().getByRole("button", { name: "Save reviewed skill", exact: true }).click();
	await poll(async () => (await h.api("skills.get", { name: doc.name })).current.revision).toBe(4);
	await h.page().getByRole("button", { name: "Edit skill", exact: true }).click();
	await h.page().getByLabel("Steps", { exact: true }).fill("Stale editor");
	await h.api("skills.save", {
		requestId: "concurrent",
		name: doc.name,
		expectedRevision: 4,
		document: { ...doc, steps: "Concurrent method" },
	});
	await h.page().getByRole("button", { name: "Review changes", exact: true }).click();
	await h.page().getByRole("button", { name: "Save reviewed skill", exact: true }).click();
	await h.page().getByRole("alert").filter({ hasText: "Skill changed" }).waitFor();
	await h.page().getByRole("button", {name:"Refresh",exact:true}).click();
 await h.page().getByRole("alert").filter({hasText:"Skill changed"}).waitFor();
 expect((await h.api("skills.get", { name: doc.name })).current.document.steps).toBe("Concurrent method");
	await h
		.page()
		.getByRole("button", { name: /sales-report/ })
		.click();
	await h.page().getByRole("button", { name: "Delete skill", exact: true }).click();
	expect((await h.api("skills.get", { name: doc.name })).current.deleted).toBe(false);
	await h.page().getByRole("button", { name: "Confirm deletion", exact: true }).click();
	await poll(async () => (await h.api("skills.get", { name: doc.name })).current.deleted).toBe(true);
	await h.page().getByRole("button", { name: "New skill", exact: true }).click();
	expect(await h.page().getByRole("button", { name: "Review changes", exact: true }).isEnabled()).toBe(false);
	for (const [label, value] of Object.entries({
		"Skill name": "new-method",
		"When to use": "New task",
		Inputs: "Input",
		Requirements: "None",
		Steps: "Do the task",
		Validation: "Check it",
		Output: "Report",
		"Approval boundaries": "Ask first",
	}))
		await h.page().getByLabel(label, { exact: true }).fill(value);
	await h.page().getByRole("button", { name: "Review changes", exact: true }).click();
	await h.page().getByRole("button", { name: "Save reviewed skill", exact: true }).click();
	await poll(async () => (await h.api("skills.list")).filter((s: any) => !s.deleted).length).toBe(1);
	await h.shot("04-edited-library-en");
});

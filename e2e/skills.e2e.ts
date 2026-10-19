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
const api = (name: string, params = {}): Promise<any> =>
	h.page().evaluate(({ name, params }) => (window as any).openbot.methods[name](params), { name, params });
const poll = (fn: () => Promise<any>) => expect.poll(fn, { timeout: 15000 });
const snapshot = (botId = core) => api("conversations.snapshot", { botId });
const box = () => h.page().locator(".compose-area textarea");
const send = async (text: string) => {
	await box().fill(text);
	await box().press("Enter");
};
beforeAll(async () => {
	h = await launchApp("skills");
	h.page().setDefaultTimeout(10000);
	await api("settings.update", { defaultModel: { provider: "scripted", modelId: "scripted" } });
	core = (await api("bots.list")).find((b: any) => b.kind === "core").botId;
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
	expect(await api("skills.list")).toEqual([]);
	h.model.script(
		{ tool: "skill_save", args: { action: "save", name: doc.name, expectedRevision: 0, document: doc } },
		{ text: "The reviewed procedure is saved." },
	);
	await send("Save the proposed procedure now.");
	await poll(async () => (await snapshot()).approvals[0]?.tool).toBe("skill_save");
	await h.page().locator(".approval").getByRole("button", { name: "Allow once", exact: true }).click();
	await h.page().getByText("The reviewed procedure is saved.", { exact: true }).waitFor();
	ref = (await api("skills.list"))[0];
	expect(ref.revision).toBe(1);
	expect((await api("skills.get", { name: doc.name })).history).toHaveLength(1);
	expect(await readFile(join(h.dataDirectory, "skills", doc.name, "SKILL.md"), "utf8")).toContain("B10_METHOD_CANARY");
	await h.page().getByRole("button", { name: "Skills", exact: true }).click();
	await h
		.page()
		.getByRole("button", { name: /sales-report/ })
		.click();
	await h.page().getByRole("button", { name: "Edit skill", exact: true }).waitFor();
	await h.shot("02-library-en");
});
it("loads from another Bot after restart without changing command policy and produces a result", async () => {
	second = (await api("bots.create", { requestId: "b10-second", name: "Analyst" })).botId;
	await h.relaunch();
	await h
		.page()
		.getByRole("button", { name: /Analyst/ })
		.click();
	await api("policy.update", { commandSetting: "never" });
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
	expect((await api("artifacts.preview", { artifactId: result.artifactId })).text).toBe("Total: 13");
});
it("pins slash-selected versions across draft reload, queue, deletion and restart", async () => {
	await api("lifecycle.pause");
	await poll(async () => (await api("lifecycle.get")).transitioning).toBe(false);
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
	await api("lifecycle.resume");
	await h.page().getByText("Pinned method retained.", { exact: true }).waitFor();
	const user = (await snapshot(second)).items.filter((i: any) => i.kind === "user").at(-1);
	expect(user.skills).toEqual([{ name: ref.name, revision: 1, sha256: ref.sha256 }]);
	const contrast = await h.page().locator(".message-user .skill-chip").last().evaluate((element) => {
		const style = getComputedStyle(element);
		const luminance = (color: string) => {
			const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((n) => {
				const value = n / 255;
				return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
			});
			return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
		};
		const foreground = luminance(style.color), background = luminance(style.backgroundColor);
		return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
	});
	expect(contrast).toBeGreaterThanOrEqual(4.5);
	await h.shot("05-attached-skill-en");
	expect(JSON.stringify(h.model.requests.at(-1)?.messages)).toContain("B10_METHOD_CANARY");
	const updated = await api("skills.save", {
		requestId: "b10-edit",
		name: doc.name,
		expectedRevision: 1,
		document: { ...doc, steps: "New procedure" },
	});
	expect(updated.revision).toBe(2);
	await expect(api("skills.save", { requestId: "stale", name: doc.name, expectedRevision: 1, document: doc })).rejects.toThrow(/changed/);
	await api("skills.delete", { requestId: "b10-delete", name: doc.name, expectedRevision: 2 });
	await h.relaunch();
	await h
		.page()
		.getByRole("button", { name: /Analyst/ })
		.click();
	expect((await snapshot(second)).items.filter((i: any) => i.kind === "user").at(-1).skills[0].revision).toBe(1);
	await api("settings.update", { language: "zh-CN" });
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
	await api("settings.update", { language: "en" });
	await h.page().getByRole("button", { name: "Restore as new version", exact: true }).click();
	await h.page().getByLabel("Steps", { exact: true }).fill("Restored procedure");
	await h.page().getByRole("button", { name: "Review changes", exact: true }).click();
	expect((await api("skills.get", { name: doc.name })).current.revision).toBe(3);
	await h.page().getByRole("button", { name: "Save reviewed skill", exact: true }).click();
	await poll(async () => (await api("skills.get", { name: doc.name })).current.revision).toBe(4);
	await h.page().getByRole("button", { name: "Edit skill", exact: true }).click();
	await h.page().getByLabel("Steps", { exact: true }).fill("Stale editor");
	await api("skills.save", {
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
 expect((await api("skills.get", { name: doc.name })).current.document.steps).toBe("Concurrent method");
	await h
		.page()
		.getByRole("button", { name: /sales-report/ })
		.click();
	await h.page().getByRole("button", { name: "Delete skill", exact: true }).click();
	expect((await api("skills.get", { name: doc.name })).current.deleted).toBe(false);
	await h.page().getByRole("button", { name: "Confirm deletion", exact: true }).click();
	await poll(async () => (await api("skills.get", { name: doc.name })).current.deleted).toBe(true);
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
	await poll(async () => (await api("skills.list")).filter((s: any) => !s.deleted).length).toBe(1);
	await h.shot("04-edited-library-en");
});

/** Useful file work through real Desktop/Host/executor, with scripted model decisions and native picker stubs. */
import { access, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { launchApp, repo, type AppHarness } from "./harness.ts";
let h: AppHarness, core: string, artifactId: string, expectedCsv: string;
const api = (name: string, params = {}): Promise<any> =>
  h.page().evaluate(({ name, params }) => (window as any).openbot.methods[name](params), { name, params });
const poll = (fn: () => Promise<any>) => expect.poll(fn, { timeout: 15000 });
const snapshot = () => api("conversations.snapshot", { botId: core });
beforeAll(async () => {
  h = await launchApp("mvp-acceptance", { prepare: async run => {
    await mkdir(join(run, "workspace/reports"));
    await copyFile(join(repo, "examples/weekly-sales.csv"), join(run, "workspace/weekly-sales.csv"));
    await copyFile(join(repo, "e2e/fixtures/weekly-sales.mjs"), join(run, "workspace/analyze-sales.mjs"));
    await writeFile(join(run, "workspace/denied-action.mjs"), "import {writeFile} from 'node:fs/promises';await writeFile('denied-action.txt','unexpected');");
    return {};
  }});
  h.page().setDefaultTimeout(15000);
  await api("settings.update", { defaultModel: { provider: "scripted", modelId: "scripted" } });
  core = (await api("bots.list")).find((b: any) => b.kind === "core").botId;
});
afterEach(async ({ task }) => { if (task.result?.state === "fail") await h.shot("failure"); });
afterAll(async () => { await h?.close(); });

it("computes a real CSV only after approval, then publishes and exports the verified result", async () => {
  h.model.script(
    { tool: "local_exec", args: { command: "node analyze-sales.mjs", description: "Calculate the weekly sales totals" } },
    { tool: "artifact_publish", args: { path: "reports/weekly-summary.csv", name: "Weekly sales.csv" } },
    { text: "The weekly CSV is ready: $13,400, up 11.7%." },
  );
  await h.send("Analyze weekly-sales.csv and publish a CSV summary after I approve the calculation.");
  await poll(async () => (await snapshot()).approvals[0]?.tool).toBe("local_exec");
  expect(await access(join(h.workspace, "calculation-runs.txt")).then(() => true, () => false)).toBe(false);
  const approval = h.page().getByRole("group", { name: "Approval request" });
  await poll(() => approval.locator(".approval-args").textContent()).toContain("node analyze-sales.mjs");
  await poll(() => h.page().locator(".bot-row").filter({ has: h.page().getByText("OpenBot", { exact: true }) }).textContent()).toContain("Needs attention");
  await approval.getByRole("button", { name: "Allow once", exact: true }).click();
  await h.page().getByText("The weekly CSV is ready: $13,400, up 11.7%.", { exact: true }).waitFor();
  await poll(async () => (await snapshot()).run).toBeUndefined();
  const summary = JSON.parse(await readFile(join(h.workspace, "reports/summary.json"), "utf8"));
  expect(summary.totals).toEqual({ "2026-10-05": 12000, "2026-10-12": 13400 });
  expect(summary.rows).toBe(12);
  expect(summary.growthPercent).toBeCloseTo(11.6666666667);
  expect(summary.products).toEqual([
    { product: "Orbit", previous: 4800, current: 6200, change: 1400 },
    { product: "Beacon", previous: 4000, current: 4400, change: 400 },
    { product: "Relay", previous: 3200, current: 2800, change: -400 },
  ]);
  expectedCsv = "product,previous_usd,current_usd,change_usd\nOrbit,4800,6200,1400\nBeacon,4000,4400,400\nRelay,3200,2800,-400\n";
  expect(await readFile(join(h.workspace, "reports/weekly-summary.csv"), "utf8")).toBe(expectedCsv);
  const published = (await snapshot()).items.find((i: any) => i.tool === "artifact_publish");
  expect(published.status).toBe("succeeded");
  artifactId = published.artifact.artifactId;
  const card = h.page().locator(`.messages .artifact-card[data-artifact-id="${artifactId}"]`);
  await card.getByRole("button", { name: "Preview", exact: true }).click();
  await h.page().getByRole("button", {name:"Source",exact:true}).click();
  expect(await h.page().locator(".reader-source").textContent()).toBe(expectedCsv);
  await h.page().getByRole("button", {name:"Close preview",exact:true}).click();
  await h.app().evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as any;
  }, join(h.run, "exported-summary.csv"));
  await card.getByRole("button", { name: "Export copy", exact: true }).click();
  await poll(() => readFile(join(h.run, "exported-summary.csv"), "utf8").catch(() => "")).toBe(expectedCsv);
  await h.shot("01-verified-sales-en");
});

it("denies a separate write and retains the exported result after restart without repeating the calculation", async () => {
  h.model.script(
    { tool: "local_exec", args: { command: "node denied-action.mjs", description: "Synthetic denied action" } },
    { text: "The action was denied; no file was created." },
  );
  await h.send("Attempt the synthetic write once; respect my denial.");
  await h.page().getByRole("button", { name: "Deny", exact: true }).click();
  await h.page().getByText("The action was denied; no file was created.", { exact: true }).waitFor();
  await poll(async () => (await snapshot()).run).toBeUndefined();
  expect(JSON.stringify(h.model.requests.at(-1)?.messages.at(-1))).toContain("denied");
  await h.page().locator(".tool-card.tool-failed", { hasText: "Synthetic denied action" }).waitFor();
  const calls = h.model.requests.length;
  await rm(join(h.workspace, "reports/weekly-summary.csv"));
  await h.relaunch();
  expect((await api("artifacts.preview", { artifactId })).text).toBe(expectedCsv);
  expect(await readFile(join(h.run, "exported-summary.csv"), "utf8")).toBe(expectedCsv);
  expect(await readFile(join(h.workspace, "calculation-runs.txt"), "utf8")).toBe("calculated\n");
  expect(await access(join(h.workspace, "denied-action.txt")).then(() => true, () => false)).toBe(false);
  expect(h.model.requests.length).toBe(calls);
  expect(await h.app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(w => !w.isVisible() && !w.isFocused()))).toBe(true);
});

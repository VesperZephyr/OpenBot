import { execFileSync } from "node:child_process";
import { mkdtemp, rm, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { BotRuntime } from "../src/index.ts";
import { scriptedModels } from "../src/testing.ts";

it("task store upgrade preserves legacy identities and baseline 1b550b9 refuses the persisted store", async () => {
  const root = await mkdtemp(join(tmpdir(), "openbot-task-baseline-")),
    baseline = join(root, "baseline"),
    repo = resolve(import.meta.dirname, "../../..");
  let runtime: BotRuntime | undefined;
  try {
    await mkdir(baseline);
    const archive = execFileSync(
      "git",
      [
        "archive",
        "1b550b9",
        "packages/agent-runtime",
        "packages/server-core/src/backup.ts",
      ],
      { cwd: repo, maxBuffer: 4 * 1024 * 1024 },
    );
    execFileSync("tar", ["-x", "-C", baseline], { input: archive });
    await writeFile(
      join(baseline, "package.json"),
      JSON.stringify({ type: "module" }),
    );
    await symlink(
      join(repo, "packages/agent-runtime/node_modules"),
      join(baseline, "packages/agent-runtime/node_modules"),
    );
    const probe = join(root, "probe.mjs"),
      databasePath = join(root, "openbot.sqlite");
    await writeFile(
      probe,
      `import {BotRuntime} from ${JSON.stringify(join(baseline, "packages/agent-runtime/src/index.ts"))};
import {scriptedModels} from ${JSON.stringify(join(baseline, "packages/agent-runtime/src/testing.ts"))};
const scripted=scriptedModels("unexpected inference");let runtime;
try {runtime=await BotRuntime.open({databasePath:process.argv[3],history:false,models:scripted.models});
if(process.argv[2]==="prepare"){const core=await runtime.ensureCoreBot(0);console.log(JSON.stringify({botId:core.botId,direct:await runtime.conversationKey(core.botId),group:await runtime.ensureChannel(core.botId,"group_legacy"),routine:await runtime.ensureChannel(core.botId,"routine_legacy")}));}
else {throw Error("Baseline unexpectedly opened the migrated store");}}
catch(error){if(process.argv[2]!=="reject")throw error;console.log(JSON.stringify({error:error.message,requests:scripted.requests()}));}
finally{await runtime?.close();}`,
    );
    const run = (mode: string) =>
      JSON.parse(
        execFileSync(
          process.execPath,
          [
            "--experimental-strip-types",
            "--disable-warning=ExperimentalWarning",
            probe,
            mode,
            databasePath,
          ],
          { encoding: "utf8", timeout: 30000 },
        ).trim(),
      );
    const before = run("prepare");
    runtime = await BotRuntime.open({
      databasePath,
      history: false,
      models: scriptedModels().models,
    });
    expect(await runtime.conversationKey(before.botId)).toBe(before.direct);
    expect(await runtime.channels()).toMatchObject([
      {
        channelId: "group_legacy",
        conversationId: Number(before.group),
        kind: "group",
      },
      {
        channelId: "routine_legacy",
        conversationId: Number(before.routine),
        kind: "routine",
      },
    ]);
    expect(await runtime.tasks().registry()).toEqual([]);
    await runtime.close();
    runtime = undefined;
    const refusal = run("reject");
    expect(refusal.error).toMatch(/version|newer|migrat/i);
    expect(refusal.error).not.toContain("unexpectedly");
    expect(refusal.requests).toBe(0);
    runtime = await BotRuntime.open({ databasePath, history: false });
    expect(await runtime.channels()).toHaveLength(2);
  } finally {
    await runtime?.close();
    await rm(root, { recursive: true, force: true });
  }
}, 60000);

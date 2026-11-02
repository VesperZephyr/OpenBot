import { mkdtemp, rm, writeFile, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { ToolInvocation } from "@openbot/protocol";
import { ExecutorProcess } from "../src/executor.ts";
it.each(["startup", "synchronization"])(
  "task stop fences the actual transport after %s",
  async (phase) => {
    const root = await mkdtemp(join(tmpdir(), "openbot-task-transport-"));
    const entry = join(root, "executor.mjs"),
      release = join(root, "release"),
      entered = join(root, "entered"),
      sent = join(root, "sent");
    await writeFile(
      entry,
      `import {watch,existsSync,writeFileSync} from 'node:fs';
const gate=async()=>{writeFileSync(${JSON.stringify(entered)},'entered');if(existsSync(${JSON.stringify(release)}))return;await new Promise(resolve=>{const watcher=watch(${JSON.stringify(root)},()=>{if(existsSync(${JSON.stringify(release)})){watcher.close();resolve();}});});};
process.on('disconnect',()=>process.exit());
process.on('message',async m=>{if(m.kind==='policy.sync'){if(${JSON.stringify(phase)}==='synchronization')await gate();process.send({kind:'policy.synced',messageId:m.messageId,confirmed:true});}if(m.kind==='tool.invoke'){writeFileSync(${JSON.stringify(sent)},'sent');process.send({kind:'tool.result',invocationId:m.invocation.invocationId,outcome:{status:'succeeded',output:'unexpected'}});}});
if(${JSON.stringify(phase)}==='startup')await gate();process.send({kind:'executor.hello',targetId:'mac'});`,
    );
    let stopped = false;
    const admitted = vi.fn(
      async (_call: ToolInvocation, _signal: AbortSignal, send: () => void) => {
        if (stopped) throw Error("Task stopped");
        send();
      },
    );
    const executor = new ExecutorProcess({
      entry,
      targetId: "mac",
      workspace: root,
      dataDirectory: root,
      env: { PATH: process.env.PATH },
      admit: admitted,
    });
    const call = {
      invocationId: "call",
      botId: "core",
      conversationId: "task",
      runId: "run",
      tool: "local_write",
      args: { path: join(root, "report.md"), content: "report" },
      target: { kind: "local", targetId: "mac" },
      grants: [],
      authorityRevision: 1,
    } as unknown as ToolInvocation;
    try {
      const response = executor.invoke(
        call,
        () => {},
        new AbortController().signal,
      );
      const rejected = expect(response).rejects.toThrow("Task stopped");
      await vi.waitFor(async () =>
        expect(await readFile(entered, "utf8")).toBe("entered"),
      );
      stopped = true;
      await writeFile(release, "go");
      await rejected;
      expect(admitted).toHaveBeenCalledTimes(1);
      await expect(access(sent)).rejects.toThrow();
    } finally {
      await executor.stop();
      await rm(root, { recursive: true, force: true });
    }
  },
);

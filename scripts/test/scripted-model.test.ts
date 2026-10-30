import { request } from "node:http";
import { setTimeout } from "node:timers/promises";
import { expect, it } from "vitest";
import { ScriptedModel } from "../../e2e/scripted-model.ts";

it("preserves model inputs when HTTP chunks split UTF-8 characters", async () => {
	const model = new ScriptedModel();
	const url = await model.start();
	try {
		model.script({ text: "Received." });
		const text = "Research 正文😀 source";
		const body = Buffer.from(JSON.stringify({ messages: [{ role: "user", content: text }] }));
		const emoji = body.indexOf(Buffer.from("😀"));
		await new Promise<void>((resolve, reject) => {
			const req = request(`${url}/chat/completions`, { method: "POST", headers: { "content-type": "application/json" } }, response => {
				response.resume();
				response.on("end", resolve);
				response.on("error", reject);
			});
			req.on("error", reject);
			void (async () => {
				req.write(body.subarray(0, emoji + 1));
				await setTimeout(10);
				req.write(body.subarray(emoji + 1, emoji + 3));
				await setTimeout(10);
				req.end(body.subarray(emoji + 3));
			})().catch(reject);
		});
		expect(model.requests[0]?.messages[0]?.content).toBe(text);
	} finally { await model.stop(); }
});

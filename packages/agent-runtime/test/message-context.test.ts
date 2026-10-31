import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { BotRuntime, type StoredRun } from "../src/index.ts";

it("excludes updates before the group context budget at the actual next model request", async () => {
	const directory = await mkdtemp(join(tmpdir(), "openbot-message-context-"));
	const faux = fauxProvider(),
		models = createModels(),
		entered = Promise.withResolvers<void>(),
		release = Promise.withResolvers<void>();
	let nextContext = "";
	faux.setResponses([
		async () => {
			entered.resolve();
			await release.promise;
			return fauxAssistantMessage("CANONICAL_GROUP_RESULT");
		},
		(context) => {
			nextContext = JSON.stringify(context.messages);
			return fauxAssistantMessage("Next result");
		},
	]);
	models.setProvider(faux.provider);
	const runtime = await BotRuntime.open({ databasePath: join(directory, "db"), models });
	try {
		await runtime.ensureCoreBot(1);
		for (const botId of ["a", "b"])
			await runtime.createBot({ botId, name: botId, createdAt: 1, model: { provider: "faux", modelId: "faux-1" } });
		await runtime
			.groups()
			.change(
				{
					action: "create",
					requestId: "group",
					groupId: "group_g",
					expectedRevision: 0,
					fields: { name: "Group", objective: "Evidence", memberIds: ["a", "b"], leadBotId: "a" },
				},
				1,
			);
		await runtime.groups().post("group_g", "first", "ORIGINAL_USER_REQUEST", ["a"], 2);
		const conversationId = await runtime.ensureChannel("a", "group_g");
		const runDelivery = async (runId: string, request: string) => {
			const delivery = (await runtime.groups().deliveries()).find((d) => d.deliveryId === JSON.stringify(["group_g", request, "a"]))!;
			const requestId = `delivery:${delivery.deliveryId}`;
			const run: StoredRun = {
				runId,
				botId: "a",
				channelId: "group_g",
				origin: "user",
				state: "queued",
				requestIds: [requestId],
				createdAt: 1,
				messages: [{ requestId, text: delivery.input }],
				inputs: [{ requestId, text: delivery.input }],
			};
			await runtime.runsStore().put(run);
			await runtime.runsStore().put({ ...run, state: "running" });
			await runtime.groups().admitted(delivery.deliveryId, runId);
			const submission = await runtime.submit("a", requestId, delivery.input, "start", "group_g");
			return { run, delivery, submission };
		};
		runtime.resume();
		const first = await runDelivery("first", "first");
		await entered.promise;
		for (let i = 0; i < 16; i++)
			await runtime
				.messages()
				.publish(
					{ botId: "a", conversationId, runId: "first", callId: `update-${i}`, targetId: "test", text: `PROGRESS_ONLY_${i}` },
					() => {},
				);
		expect(await runtime.groups().deliveries()).toHaveLength(1);
		expect((await runtime.groups().roots("group_g"))[0]?.automaticDeliveries).toBe(0);
		release.resolve();
		await runtime.waitSubmission("a", first.submission.submissionId, "group_g");
		await runtime
			.runsStore()
			.put({
				...first.run,
				state: "completed",
				inputs: [{ ...first.run.inputs[0]!, submissionId: first.submission.submissionId, outcome: { status: "done" } }],
			});
		await runtime.groups().finish(first.delivery.deliveryId, "completed", "CANONICAL_GROUP_RESULT", 3);
		await runtime.groups().post("group_g", "second", "NEW_USER_REQUEST", ["a"], 4);
		const second = await runDelivery("second", "second");
		await runtime.waitSubmission("a", second.submission.submissionId, "group_g");
		expect(nextContext).toContain("CANONICAL_GROUP_RESULT");
		expect(nextContext).toContain("ORIGINAL_USER_REQUEST");
		expect(nextContext).toContain("NEW_USER_REQUEST");
		expect(nextContext).not.toContain("PROGRESS_ONLY_");
		expect((await runtime.groups().posts("group_g")).filter((p) => p.kind === "update")).toHaveLength(16);
		await runtime.groups().change({ action: "dissolve", requestId: "dissolve", groupId: "group_g", expectedRevision: 1 }, 5);
		await expect(
			runtime
				.messages()
				.publish({ botId: "a", conversationId, runId: "second", callId: "after-dissolve", targetId: "test", text: "Forbidden" }, () => {}),
		).rejects.toThrow("unavailable");
	} finally {
		release.resolve();
		await runtime.close();
		await rm(directory, { recursive: true, force: true });
	}
});

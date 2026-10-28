/** Runs only the disposable projection database, never Pi or tools. */
import { ProtocolError } from "@openbot/protocol";
import { parentPort, workerData } from "node:worker_threads";
import { HistoryStore } from "./history-store.ts";
import type { HistoryRequest, HistoryResponse } from "./history-worker-protocol.ts";
const port = parentPort!;
const store = new HistoryStore(workerData.path, workerData.source);
const jobs = new Map<number, AbortController>();
port.on("message", async (request: HistoryRequest) => {
	if (request.method === "cancel") {
		jobs.get(request.id)?.abort();
		return;
	}
	const controller = new AbortController();
	jobs.set(request.id, controller);
	try {
		let value: unknown;
		switch (request.method) {
			case "apply":
				store.apply(request.batch);
				break;
			case "checkpoint":
				value = store.checkpoint(request.partition);
				break;
			case "link":
				value = store.link(request.partition, request.rowId);
				break;
			case "stageDetail":
				store.stageDetail(request.partition, request.rowId, request.part, request.text);
				break;
			case "stageMessage":
				store.stageMessage(request.partition, request.rowId, request.part, request.text);
				break;
			case "detail":
				value = store.detail(request.key, request.token, request.part);
				break;
			case "context":
				value = store.context(request.key, request.rowId, request.before, request.after);
				break;
			case "window":
				value = store.window(request.input);
				break;
			case "search":
				value = await store.search(
					request.query,
					request.keys,
					request.scope,
					request.cursor,
					AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
				);
				break;
			case "close":
				store.close();
				port.postMessage({ id: request.id, value: null } satisfies HistoryResponse);
				port.close();
				return;
		}
		port.postMessage({ id: request.id, value } satisfies HistoryResponse);
	} catch (error) {
		port.postMessage({
			id: request.id,
			code: error instanceof ProtocolError ? error.code : undefined,
			error:
				error instanceof Error &&
				[
					"Invalid application cursor",
					"History is still indexing",
					"Message is unavailable",
					"History changed. Reload this location.",
				].includes(error.message)
					? error.message
					: "History is unavailable",
		} satisfies HistoryResponse);
	} finally {
		jobs.delete(request.id);
	}
});
port.postMessage({ id: 0, value: { generation: store.generation } } satisfies HistoryResponse);

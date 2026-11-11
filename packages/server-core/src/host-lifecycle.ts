import { randomUUID } from "node:crypto";
import type { BotRuntime } from "@openbot/agent-runtime";
import type { BotId } from "@openbot/protocol";
import type { ApprovalBook } from "./approvals.ts";
import type { AuthorityCoordinator } from "./authority.ts";
import type { BackgroundTasks } from "./background.ts";
import type { Connectors } from "./connectors.ts";
import type { ConversationFeed } from "./conversation-feed.ts";
import type { ObserverState } from "./host-conversations.ts";
import type { OperationAudit } from "./host-ports.ts";
import type { Groups } from "./groups.ts";
import type { LifecycleController } from "./lifecycle.ts";
import type { LocalTasks } from "./local-tasks.ts";
import type { Observation } from "./observation.ts";
import type { Routines } from "./routines.ts";
import type { RunScheduler } from "./runs.ts";

export type HostSession = {
	readonly runtime: BotRuntime;
	readonly observation: Observation;
	readonly tasks: LocalTasks;
	readonly lifecycle: LifecycleController;
	reloadModelConfig(): Promise<void>;
	now(): number;
	audit(event: OperationAudit): void;
	readonly targetId: string;
	readonly approvals: ApprovalBook;
	readonly connectors: Connectors;
	observe(botId: BotId): Promise<void>;
	readonly authority: AuthorityCoordinator;
	readonly routines: Routines;
	readonly runs: RunScheduler;
	readonly groups: Groups;
	readonly background: BackgroundTasks;
	readonly feed: ConversationFeed;
	readonly observers: Map<BotId, ObserverState>;
	stopHistory(): (() => void) | undefined;
	setStopHistory(stop: () => void): void;
};

/**
 * Load the model configuration and pending approvals, attach observers to every existing Bot, then sweep Runs left
 * by the last shutdown. Call once after the runtime opened and before it resumes, so approvals from before a
 * restart show before Pi reruns.
 */
export async function startHostSession(host: HostSession): Promise<void> {
	const historyStop = host.runtime.onHistoryChanged(() => {
		host.observation.changed(7);
		void host.tasks.changed();
	});
	const taskActivity = () => host.observation.changed(1);
	host.runtime.execution.changes.add(taskActivity);
	host.setStopHistory(() => {
		historyStop();
		host.runtime.execution.changes.delete(taskActivity);
	});
	await host.lifecycle.start();
	await host.reloadModelConfig();
	const at = host.now();
	await host.runtime.ensureCoreBot(at);
	try {
		host.audit({ operationId: randomUUID(), operation: "core.ensure", at, durationMs: host.now() - at, outcome: "succeeded" });
	} catch {
		/* Keep diagnostics independent of startup. */
	}
	await host.runtime.policy().bind(host.targetId);
	await host.approvals.start(host.runtime.approvals());
	await host.connectors.start();
	for (const bot of await host.runtime.listBots()) if (bot.status !== "deleted") await host.observe(bot.botId);
	await host.authority.reconcile();
	await host.routines.prepare();
	await host.runs.start();
	await host.tasks.changed();
	if (host.lifecycle.state.needsResume && !host.lifecycle.state.autoResume) await host.lifecycle.pause("recovery").catch(() => {});
	await host.groups.start();
	await host.background.start();
	await host.routines.start();
	if (!host.lifecycle.state.blocked) host.runtime.resume();
}

/** Call before the runtime closes: the shutdown aborts waiting calls, and their approvals must stay pending. */
export async function stopHostSession(host: HostSession): Promise<void> {
	host.stopHistory()?.();
	await host.tasks.close();
	await host.routines.close();
	await host.background.close();
	await host.connectors.close();
	host.observation.close();
	await host.groups.stop();
	host.approvals.close();
	host.runs.stop();
	host.feed.stop();
	for (const observer of host.observers.values()) observer.stop();
	host.observers.clear();
}

/**
 * What the roster means for the rest of macOS: notifications for approvals that appear and Runs that finish, the dock
 * badge (pending approvals across Bots), and whether the Mac must stay awake (some Bot works or waits for a slot).
 * Pure, so the transitions are testable without Electron; `index.ts` applies the result.
 */
import type { BotSummary } from "@openbot/protocol";

export type AttentionNotice = { readonly botId: string; readonly title: string; readonly body: string };

export type Attention = {
	readonly badge: number;
	readonly keepAwake: boolean;
	/** Changes since the previous roster; empty for the first roster after a (re)connect. */
	readonly notices: readonly AttentionNotice[];
};

/**
 * Compare two rosters. `previous` is `undefined` for the first roster after the Host (re)started: it sets the baseline
 * and never notifies, so a restart does not replay old events.
 */
export function attention(previous: readonly BotSummary[] | undefined, next: readonly BotSummary[]): Attention {
	const badge = next.reduce((sum, bot) => sum + bot.pendingApprovals, 0);
	const keepAwake = next.some((bot) => bot.activity === "working" || bot.activity === "queued");
	if (previous === undefined) return { badge, keepAwake, notices: [] };

	const before = new Map(previous.map((bot) => [bot.botId, bot]));
	const notices: AttentionNotice[] = [];
	for (const bot of next) {
		const old = before.get(bot.botId);
		if (bot.pendingApprovals > (old?.pendingApprovals ?? 0)) {
			notices.push({ botId: bot.botId, title: bot.name, body: "Needs your approval to continue" });
		}
		const run = bot.lastRun;
		if (run === undefined || (run.state !== "completed" && run.state !== "failed")) continue;
		if (old?.lastRun?.runId === run.runId && old.lastRun.state === run.state) continue;
		notices.push(
			run.state === "completed"
				? { botId: bot.botId, title: bot.name, body: "Finished" }
				: { botId: bot.botId, title: bot.name, body: run.error === undefined ? "Could not finish" : `Could not finish: ${run.error}` },
		);
	}
	return { badge, keepAwake, notices };
}

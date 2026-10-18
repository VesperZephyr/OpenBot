import { useEffect, useRef, useState } from "react";
import type { ConversationSearchHit, ConversationSearchResult } from "@openbot/protocol";
import { api, openBot, report, useStore } from "./store";
import { t } from "./i18n";

export async function openSearchResult(hit: ConversationSearchHit): Promise<void> {
	const state = useStore.getState();
	const id = hit.conversationKey.slice(hit.conversationKey.indexOf(":") + 1);
	const target = { conversationKey: hit.conversationKey, messageId: hit.messageId, nonce: crypto.randomUUID() };
	if (hit.conversationKey.startsWith("bot:")) {
		if (!state.bots.some((b) => b.botId === id)) throw new Error("Search result is no longer available");
		await openBot(id, target);
	} else {
		if (!state.groups.some((g) => g.groupId === id)) throw new Error("Search result is no longer available");
		useStore.setState({ searchTarget: target, view: { kind: "group", groupId: id } });
	}
}

export function ConversationSearch({ query, unreadOnly }: { query: string; unreadOnly: boolean }) {
	const bots = useStore((s) => s.bots), groups = useStore((s) => s.groups), summaries = useStore((s) => s.summaries);
	const language = useStore((s) => s.settings?.language ?? "en");
	const normalized = query.replace(/\s+/gu, " ").trim();
	const key = JSON.stringify([normalized, unreadOnly]);
	const [result, setResult] = useState<{ key: string; data: ConversationSearchResult }>();
	const [pending, setPending] = useState(false), [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
	const generation = useRef(0);
	useEffect(() => {
		const version = ++generation.current;
		setResult(undefined); setFailed(false); setPending(!!normalized);
		if (!normalized) return;
		const timer = setTimeout(() => {
			void api["conversations.search"]({ query: normalized, unreadOnly, includeHidden: true }).then((data) => {
				if (version === generation.current) setResult({ key, data });
			}).catch(() => { if (version === generation.current) setFailed(true); })
				.finally(() => { if (version === generation.current) setPending(false); });
		}, 200);
		return () => { clearTimeout(timer); generation.current++; };
	}, [key, bots, groups, summaries, retry]);
	const more = async () => {
		const cursor = result?.key === key ? result.data.nextCursor : undefined;
		if (!cursor || pending) return;
		const version = generation.current;
		setPending(true); setFailed(false);
		try {
			const data = await api["conversations.search"]({ query: normalized, unreadOnly, includeHidden: true, cursor });
			if (version === generation.current) setResult((old) => old?.key === key ? {
				key, data: { ...data, items: [...old.data.items, ...data.items] },
			} : old);
		} catch { if (version === generation.current) setFailed(true); }
		finally { if (version === generation.current) setPending(false); }
	};
	if (!normalized) return null;
	const hits = result?.key === key ? result.data.items : [];
	return (
		<section className="search-results" aria-label={t("Message results")} aria-busy={pending}>
			<h2 className="section-title">{t("Messages")}</h2>
			{hits.map((hit) => {
				const bot = bots.find((b) => `bot:${b.botId}` === hit.conversationKey);
				const name = bot?.name ?? groups.find((g) => `group:${g.groupId}` === hit.conversationKey)?.name ?? t("Unavailable conversation");
				const sender = hit.senderId === "user" ? t("You") : bots.find((b) => b.botId === hit.senderId)?.name ?? t("Deleted Bot");
				return <button className="search-result" key={`${hit.conversationKey}/${hit.messageId}`} onClick={() => void openSearchResult(hit).catch(report)}>
					<span className="search-result-name">{name}{bot?.status === "hidden" && <small> · {t("Hidden Bot")}</small>}</span>
					<span className="search-result-meta">{sender} · {new Date(hit.at).toLocaleString(language === "zh-CN" ? "zh-CN" : "en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
					<span className="search-snippet">{hit.snippet.slice(0, hit.matchStart)}<mark>{hit.snippet.slice(hit.matchStart, hit.matchEnd)}</mark>{hit.snippet.slice(hit.matchEnd)}</span>
				</button>;
			})}
			{pending && <p className="search-status" role="status">{t("Searching messages…")}</p>}
			{failed ? <div className="search-status" role="status">{t("Could not search messages")} <button onClick={() => setRetry((n) => n + 1)}>{t("Retry")}</button></div>
				: !pending && !hits.length && <p className="search-status" role="status">{t(unreadOnly ? "No matching messages in unread conversations" : "No matching messages")}</p>}
			{result?.key === key && result.data.nextCursor && !failed && <button className="search-more" disabled={pending} onClick={() => void more()}>{t("Load more messages")}</button>}
		</section>
	);
}

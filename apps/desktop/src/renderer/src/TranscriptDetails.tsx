import { t } from "./i18n";
/**
 * Transcript details from B7: the collapsed "Ran N steps" row, message times shown on hover, and Reveal in Finder for
 * files a Bot wrote.
 */
import type { TranscriptItem } from "@openbot/protocol";
import { useState, type ReactNode } from "react";
import { report, useStore } from "./store";

/** Consecutive successful tool calls, collapsed; expanding shows each call's own row. */
export function StepsRow({ count, children,forceOpen=false,onExpanded }: { readonly count: number; readonly children: ReactNode|(()=>ReactNode);forceOpen?:boolean;onExpanded?:(open:boolean)=>void }) {
 const [expanded,setExpanded]=useState(forceOpen);
	return (
		<li className="steps-row">
			<details open={forceOpen||expanded} onToggle={e=>{setExpanded(e.currentTarget.open);onExpanded?.(e.currentTarget.open);}}>
				<summary>
					<span className="tool-status" aria-hidden />
					<span className="tool-verb">{t("Ran {count} steps", {count})}</span>
				</summary>
				<ol className="steps-list">{(forceOpen||expanded)&&(typeof children==="function"?children():children)}</ol>
			</details>
		</li>
	);
}



/** When a message was sent or answered; visible while the pointer is over the message. */
export function MessageTime({ at }: { readonly at: number | undefined }) {
	if (at === undefined) return null;
	const language = useStore.getState().settings?.language ?? "en";
	const TIME = new Intl.DateTimeFormat(language, { hour: "numeric", minute: "2-digit" });
	const DATE_TIME = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" });
	const date = new Date(at);
	const today = date.toDateString() === new Date().toDateString();
	return (
		<time className="message-time" dateTime={date.toISOString()} title={DATE_TIME.format(date)}>
			{today ? TIME.format(date) : DATE_TIME.format(date)}
		</time>
	);
}

/** Files the Bot created or edited: show them in Finder. Main asks the Host whether the path may be revealed. */
export function RevealButton({ item }: { readonly item: Extract<TranscriptItem, { kind: "tool" }> }) {
	if (item.status !== "succeeded" || (item.tool !== "local_write" && item.tool !== "local_edit")) return null;
	const args = item.args;
	const path = typeof args === "object" && args !== null && "path" in args && typeof args.path === "string" ? args.path : undefined;
	if (path === undefined) return null;
	return (
		<button
			type="button"
			className="reveal"
			onClick={(event) => {
				// Inside the row's summary: revealing must not also open or close the row.
				event.preventDefault();
				void window.openbot.revealPath(path).catch(report);
			}}
		>{t("Reveal in Finder")}</button>
	);
}

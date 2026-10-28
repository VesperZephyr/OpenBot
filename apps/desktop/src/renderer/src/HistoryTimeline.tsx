import { StepsRow } from "./TranscriptDetails";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import type { TimelinePosition, TimelineRow, TimelineWindow, WindowInput } from "@openbot/protocol";
import { api, useStore } from "./store";
import { t } from "./i18n";
import { useReadReceipt } from "./useReadReceipt";
import {
	historyCacheMetrics,
	cachedHistory,
	cacheHistory,
	historyAnchors,
	historyEpoch,
	historyKey,
	saveAnchor,
	type HistoryAnchor,
} from "./history-cache";

type Selector = Pick<WindowInput, "conversationKey" | "deliveryId" | "occurrenceId">;
type Props = Selector & {
	activity: string;
	renderRow: (row: TimelineRow, context: { rows: readonly TimelineRow[]; atLatest: boolean }) => ReactNode;
	children?: ReactNode;
	empty?: ReactNode;
	className?: string;
};
/** Bodies are windowed before React elements are created. Live controls never wait for history. */
export function HistoryTimeline(props: Props) {
	const key = historyKey(props);
	return <HistoryView key={key} {...props} cacheKey={key} />;
}
function HistoryView({
	cacheKey,
	conversationKey,
	deliveryId,
	occurrenceId,
	activity,
	renderRow,
	children,
	empty,
	className = "",
}: Props & { cacheKey: string }) {
	const revision = useStore((s) => s.historyRevision);
	const selector = { conversationKey, ...(deliveryId ? { deliveryId } : {}), ...(occurrenceId ? { occurrenceId } : {}) };
	const target = useStore((s) =>
		!deliveryId && !occurrenceId && s.searchTarget?.conversationKey === conversationKey ? s.searchTarget : undefined,
	);
	const [pages, setPages] = useState(() => cachedHistory(cacheKey));
	const [status, setStatus] = useState("loading"),
		[unseen, setUnseen] = useState(false);
	const ref = useRef<HTMLDivElement>(null),
		content = useRef<HTMLDivElement>(null);
	const anchor = useRef<HistoryAnchor>(
		target ? { id: target.messageId, offset: 80, following: false } : (historyAnchors.get(cacheKey) ?? { offset: 0, following: true }),
	);
	const request = useRef(0),
		busy = useRef(false),
		alive = useRef(true),
		timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const refreshWanted = useRef(false);
	const restoredTop = useRef(0);
	const [following, setFollowing] = useState(anchor.current.following);
	const restoration = useRef(0);
	const restoring = useRef(false),
		initialized = useRef(false);
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
	const rows = useMemo(() => {
		const result: (TimelineRow & { bundle?: TimelineRow[] })[] = [];
		let run: TimelineRow[] = [];
		const flush = () => {
			if (run.length > 1) result.push({ ...run[0]!, bundle: run });
			else result.push(...run);
			run = [];
		};
		for (const row of pages.flatMap((p) => p.rows)) {
			const item = row.content.kind === "direct" ? row.content.item : undefined;
			if (item?.kind === "tool" && item.status === "succeeded" && !item.artifact && !item.taskId) {
				run.push(row);
				if (run.length === 20) flush();
			} else {
				flush();
				result.push(row);
			}
		}
		flush();
		return result;
	}, [pages]);
	const first = pages[0],
		last = pages.at(-1);
	const renderContext = { rows: pages.flatMap((p) => p.rows), atLatest: last?.atLatest === true };
	const tail = last?.atLatest === true;
	const getItemKey = useCallback((index: number) => rows[index]?.id ?? "live", [rows]);
	const virtual = useVirtualizer({
		count: rows.length + 1,
		getScrollElement: () => ref.current,
		estimateSize: () => 120,
		getItemKey,
		overscan: 5,
		anchorTo: "end",
		followOnAppend: following,
		rangeExtractor: (range) => {
			const candidates = defaultRangeExtractor(range),
				selected: number[] = [];
			let budget = 80;
			for (const index of candidates.sort((a, b) => Math.abs(a - range.startIndex) - Math.abs(b - range.startIndex))) {
				const row = rows[index],
					open = row && (expanded.has(row.id) || row.bundle?.some((r) => r.id === target?.messageId));
				const cost = 1 + (open ? (row?.bundle?.length ?? 0) : 0);
				if (cost <= budget) {
					selected.push(index);
					budget -= cost;
				}
			}
			return selected.sort((a, b) => a - b);
		},
	});
	useReadReceipt(conversationKey, !deliveryId && !occurrenceId && tail ? last?.readCursor : undefined, ref, () => anchor.current.following);
	const capture = () => {
		if (restoring.current || !initialized.current || !ref.current) return;
		const el = ref.current,
			y = el.getBoundingClientRect().top;
		const row = [...el.querySelectorAll<HTMLElement>("[data-history-row]")].find((e) => e.getBoundingClientRect().bottom > y);
		anchor.current = {
			following: tail && el.scrollHeight - el.clientHeight - el.scrollTop <= 80,
			offset: row ? row.getBoundingClientRect().top - y : 0,
			...(row?.dataset.historyRow ? { id: row.dataset.historyRow } : {}),
		};
		saveAnchor(cacheKey, anchor.current);
		setFollowing(anchor.current.following);
		if (anchor.current.following) setUnseen(false);
	};
	const restore = () => {
		const el = ref.current;
		if (!el) return;
		if (!rows.length) {
			initialized.current = true;
			return;
		}
		const version = ++restoration.current;
		restoring.current = true;
		const saved = { ...anchor.current };
		if (saved.following && tail) {
			el.scrollTop = el.scrollHeight;
		} else if (saved.id) {
			const index = rows.findIndex((r) => r.id === saved.id || r.bundle?.some((b) => b.id === saved.id));
			if (index >= 0) {
				const mounted = el.querySelector<HTMLElement>(`[data-index="${index}"]`);
				if (mounted) el.scrollTop += mounted.getBoundingClientRect().top - el.getBoundingClientRect().top - saved.offset;
				else virtual.scrollToIndex(index, { align: "start" });
			}
		}
		restoredTop.current = el.scrollTop;
		requestAnimationFrame(() => {
			if (!alive.current || version !== restoration.current) return;
			if (saved.following && tail) el.scrollTop = el.scrollHeight;
			else if (saved.id) {
				const row = [...el.querySelectorAll<HTMLElement>("[data-message-id], [data-history-row]")].find(
					(n) => (n.dataset.messageId ?? n.dataset.historyRow) === saved.id,
				);
				if (row) el.scrollTop += row.getBoundingClientRect().top - el.getBoundingClientRect().top - saved.offset;
			}
			restoredTop.current = el.scrollTop;
			requestAnimationFrame(() => {
				if (version !== restoration.current) return;
				restoring.current = false;
				initialized.current = true;
			});
		});
	};
	const load = async (position: TimelinePosition) => {
		const token = ++request.current,
			epoch = historyEpoch();
		busy.current = true;
		clearTimeout(timer.current);
		try {
			const result = await api["conversations.window"]({ ...selector, position, limit: 100 });
			if (!alive.current || token !== request.current || epoch !== historyEpoch()) return;
			if (result.status !== "ready") {
				setStatus(result.status);
				if (result.status === "building") timer.current = setTimeout(() => void load(position), 120);
				return;
			}
			setPages(cacheHistory(cacheKey, result.window, position));
			setStatus("ready");
		} catch (error) {
			if (!alive.current || token !== request.current) return;
			const message = error instanceof Error ? error.message : "";
			if (position.kind === "cursor" && /conflict|changed/i.test(message)) {
				void load(anchor.current.id ? { kind: "around", rowId: anchor.current.id } : { kind: "latest" });
				return;
			}
			setStatus(/not_found|unavailable/i.test(message) && position.kind === "around" ? "missing" : "unavailable");
		} finally {
			if (token === request.current) {
				busy.current = false;
				if (refreshWanted.current && alive.current) {
					refreshWanted.current = false;
					timer.current = setTimeout(
						() =>
							void load(
								anchor.current.following
									? { kind: "latest" }
									: anchor.current.id
										? { kind: "around", rowId: anchor.current.id }
										: { kind: "latest" },
							),
						0,
					);
				}
			}
		}
	};
	const interruptRestore = () => {
		restoration.current++;
		restoring.current = false;
		initialized.current = true;
	};
	const latest = () => {
		useStore.setState({ searchTarget: undefined });
		anchor.current = { offset: 0, following: true };
		setFollowing(true);
		setUnseen(false);
		void load({ kind: "latest" });
	};
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
			request.current++;
			clearTimeout(timer.current);
			saveAnchor(cacheKey, anchor.current);
		};
	}, []);
	useEffect(() => {
		if (target) {
			anchor.current = { id: target.messageId, offset: 80, following: false };
			setFollowing(false);
		}
		void load(
			anchor.current.following ? { kind: "latest" } : anchor.current.id ? { kind: "around", rowId: anchor.current.id } : { kind: "latest" },
		);
	}, [target?.nonce]);
	useEffect(() => {
		if (!initialized.current) return;
		const id = setTimeout(() => {
			if (!anchor.current.following) setUnseen(true);
			if (busy.current) {
				refreshWanted.current = true;
				return;
			}
			void load(
				anchor.current.following
					? { kind: "latest" }
					: anchor.current.id
						? { kind: "around", rowId: anchor.current.id }
						: { kind: "latest" },
			);
		}, 50);
		return () => clearTimeout(id);
	}, [activity, revision]);
	useLayoutEffect(restore, [pages, activity]);
	useEffect(() => {
		const reset = () => {
			request.current++;
			setPages([]);
			anchor.current = { offset: 0, following: true };
			void load({ kind: "latest" });
		};
		const sent = (event: Event) => {
			if ((event as CustomEvent).detail === conversationKey && !deliveryId && !occurrenceId) latest();
		};
		window.addEventListener("openbot:history-reset", reset);
		window.addEventListener("openbot:sent", sent);
		return () => {
			window.removeEventListener("openbot:history-reset", reset);
			window.removeEventListener("openbot:sent", sent);
		};
	}, []);
	useLayoutEffect(() => {
		const observer = new ResizeObserver(() => restore());
		if (ref.current) observer.observe(ref.current);
		if (content.current) observer.observe(content.current);
		return () => observer.disconnect();
	}, [rows, tail]);
	return (
		<div
			data-history-cache={JSON.stringify(historyCacheMetrics())}
			className={`timeline-frame ${deliveryId || occurrenceId ? "execution-timeline" : ""}`}
		>
			{target && (
				<div className="search-location" role="status">
					{t(status === "missing" ? "Search result is no longer available" : "Viewing a search result")}
				</div>
			)}
			{status !== "ready" && (
				<div role="status" className="history-status">
					{t(
						status === "building"
							? "Preparing history…"
							: status === "loading"
								? "Loading history…"
								: status === "missing"
									? "Message is unavailable"
									: "History is unavailable",
					)}
					{status === "unavailable" && (
						<button onClick={() => void api["conversations.indexRetry"]({}).then(() => load({ kind: "latest" }))}>{t("Retry")}</button>
					)}
				</div>
			)}
			<div
				ref={ref}
				className={`transcript timeline-scroll ${className}`}
				onWheel={interruptRestore}
				onTouchStart={interruptRestore}
				onPointerDown={interruptRestore}
				onKeyDown={(event) => {
					if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) interruptRestore();
				}}
				onScroll={() => {
					const el = ref.current;
					// A new reading position takes precedence over a pending tail correction.
					if (
						el &&
						restoring.current &&
						initialized.current &&
						anchor.current.following &&
						el.scrollTop < restoredTop.current - 1 &&
						el.scrollHeight - el.clientHeight - el.scrollTop > 80
					)
						interruptRestore();
					capture();
					if (!el || busy.current || !initialized.current || restoring.current) return;
					if (el.scrollTop < 180 && first?.before) void load({ kind: "cursor", cursor: first.before });
					else if (el.scrollHeight - el.clientHeight - el.scrollTop < 180 && last?.after) void load({ kind: "cursor", cursor: last.after });
				}}
			>
				{first?.before && (
					<button className="history-page" onClick={() => void load({ kind: "cursor", cursor: first.before! })}>
						{t("Load earlier messages")}
					</button>
				)}
				<div
					ref={content}
					className="timeline-content history-virtual"
					style={{ height: Math.max(virtual.getTotalSize(), rows.length ? 0 : (ref.current?.clientHeight ?? 0)), position: "relative" }}
				>
					{virtual.getVirtualItems().map((v) => {
						const row = rows[v.index];
						return (
							<div
								key={v.key}
								data-index={v.index}
								data-history-row={row?.id}
								ref={virtual.measureElement}
								className={`history-row ${target && target.messageId === row?.id && !(row?.content.kind === "direct" && row.content.item.kind === "tool") ? "search-target" : ""}`}
								style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${v.start}px)` }}
							>
								{row ? (
									row.content.kind === "large" ? (
										<LargeHistoryRow conversationKey={conversationKey} row={row} />
									) : row.bundle ? (
										<StepsRow
											count={row.bundle.length}
											forceOpen={row.bundle.some((r) => r.id === target?.messageId)}
											onExpanded={(open) =>
												setExpanded((previous) => {
													if (previous.has(row.id) === open) return previous;
													const next = new Set(previous);
													if (open) next.add(row.id);
													else next.delete(row.id);
													return next;
												})
											}
										>
											{() => row.bundle!.map((child) => <div key={child.id}>{renderRow(child, renderContext)}</div>)}
										</StepsRow>
									) : (
										renderRow(row, renderContext)
									)
								) : (
									<>
										{!rows.length && status === "ready" && empty}
										{children}
									</>
								)}
							</div>
						);
					})}
				</div>
				{last?.after && (
					<button className="history-page" onClick={() => void load({ kind: "cursor", cursor: last.after! })}>
						{t("Load newer messages")}
					</button>
				)}
			</div>
			{(!anchor.current.following || unseen || target) && (
				<button type="button" className="jump-latest" onClick={latest}>
					{t(unseen ? "New activity · Jump to latest" : "Jump to latest")} ↓
				</button>
			)}
		</div>
	);
}
function LargeHistoryRow({ conversationKey, row }: { conversationKey: WindowInput["conversationKey"]; row: TimelineRow }) {
	const content = row.content;
	if (content.kind !== "large") return null;
	return <LargeDetail key={content.detail} conversationKey={conversationKey} preview={content.preview} detail={content.detail} />;
}
function LargeDetail({
	conversationKey,
	preview,
	detail,
}: {
	conversationKey: WindowInput["conversationKey"];
	preview: string;
	detail: string;
}) {
	const [parts, setParts] = useState<{ part: number; text: string }[]>([]),
		[next, setNext] = useState<number | undefined>(0),
		[error, setError] = useState(false);
	const version = useRef(0);
	const [loading, setLoading] = useState(false);
	useEffect(
		() => () => {
			version.current++;
		},
		[],
	);
	const load = async (part: number) => {
		const current = ++version.current;
		setLoading(true);
		try {
			const result = await api["conversations.detail"]({ conversationKey, detail, part });
			if (current !== version.current) return;
			setParts((old) => [...old.filter((p) => p.part !== part), { part, text: result.text }].sort((a, b) => a.part - b.part).slice(-3));
			setNext(result.nextPart);
			setError(false);
		} catch {
			if (current === version.current) setError(true);
		} finally {
			if (current === version.current) setLoading(false);
		}
	};
	return (
		<article className="large-history" data-message-id={detail}>
			<p>{t("Large message")}</p>
			<pre>{parts.length ? parts.map((p) => p.text).join("") : preview}</pre>
			{error && <p role="status">{t("History changed. Reload this location.")}</p>}
			{parts[0] && parts[0].part > 0 && (
				<button
					disabled={loading}
					onClick={() => {
						setParts([]);
						void load(parts[0]!.part - 1);
					}}
				>
					{t("Previous part")}
				</button>
			)}
			{next !== undefined && (
				<button disabled={loading} onClick={() => void load(next)}>
					{t(parts.length ? "Next part" : "Read full message")}
				</button>
			)}
			{parts.length > 0 && (
				<button onClick={() => void window.openbot.copyText(parts.map((p) => p.text).join(""))}>{t("Copy displayed parts")}</button>
			)}
		</article>
	);
}

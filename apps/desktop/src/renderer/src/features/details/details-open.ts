import { useSyncExternalStore } from "react";

const KEY = "openbot.details.open";

function read(): boolean {
	try {
		return localStorage.getItem(KEY) === "1";
	} catch {
		return false;
	}
}

let open = read();
const listeners = new Set<() => void>();

function publish(): void {
	for (const listener of listeners) listener();
}

export function detailsOpenSnapshot(): boolean {
	return open;
}

export function setDetailsOpen(next: boolean): void {
	if (open === next) return;
	open = next;
	try {
		localStorage.setItem(KEY, next ? "1" : "0");
	} catch {
		/* The window can still toggle the panel for this session. */
	}
	publish();
}

export function toggleDetails(): void {
	setDetailsOpen(!open);
}

export function subscribeDetails(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function useDetailsOpen(): boolean {
	return useSyncExternalStore(subscribeDetails, detailsOpenSnapshot, detailsOpenSnapshot);
}

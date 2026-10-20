/** Calendar occurrences select the first DST fold and skip nonexistent wall times. */
import { ProtocolError, type RoutineSchedule } from "@openbot/protocol";
const MINUTE = 60000,
	DAY = 86400000;
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timezone: string): Intl.DateTimeFormat {
	let value = formatters.get(timezone);
	if (!value) {
		try {
			value = new Intl.DateTimeFormat("en-GB", {
				timeZone: timezone,
				year: "numeric",
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
				hourCycle: "h23",
			});
		} catch {
			throw new ProtocolError("invalid_request", "Choose a valid IANA time zone");
		}
		if (formatters.size >= 128) formatters.clear();
		formatters.set(timezone, value);
	}
	return value;
}
function wall(at: number, zone: string): number {
	const p = Object.fromEntries(
		formatter(zone)
			.formatToParts(at)
			.map((p) => [p.type, p.value]),
	);
	return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
}
function instants(local: number, zone: string): number[] {
	const offsets = new Set([-DAY, 0, DAY].map((delta) => wall(local + delta, zone) - (local + delta)));
	return [...offsets]
		.map((offset) => local - offset)
		.filter((at) => wall(at, zone) === local)
		.sort((a, b) => a - b);
}
export function scheduleAt(schedule: RoutineSchedule, anchor: number, at: number, direction: "next" | "previous"): number {
	if (schedule.kind === "interval") {
		const period = schedule.minutes * MINUTE;
		return anchor + (direction === "next" ? Math.floor((at - anchor) / period) + 1 : Math.floor((at - anchor) / period)) * period;
	}
	const local = new Date(wall(at, schedule.timezone));
	const day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
	const [hour, minute] = schedule.time.split(":").map(Number);
	for (let i = 0; i < 16; i++) {
		const date = day + i * DAY * (direction === "next" ? 1 : -1);
		if (schedule.kind === "weekly" && (new Date(date).getUTCDay() || 7) !== schedule.weekday) continue;
		const candidate = instants(date + hour! * 3600000 + minute! * MINUTE, schedule.timezone)[0];
		if (candidate !== undefined && (direction === "next" ? candidate > at : candidate <= at)) return candidate;
	}
	throw new ProtocolError("invalid_request", "No valid scheduled time was found");
}

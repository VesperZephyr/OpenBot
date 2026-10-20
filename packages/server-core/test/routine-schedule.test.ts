import { expect, it } from "vitest";
import { scheduleAt } from "../src/routine-schedule.ts";
const at = Date.parse;
const daily = (time: string, timezone = "America/New_York") => ({ kind: "daily" as const, time, timezone });
it("keeps intervals on a UTC anchor and chooses strictly future instants", () => {
	const start = at("2026-01-01T00:01:23Z"),
		s = { kind: "interval" as const, minutes: 5 };
	expect(scheduleAt(s, start, start, "next")).toBe(start + 300000);
	expect(scheduleAt(s, start, start + 600000, "previous")).toBe(start + 600000);
	expect(scheduleAt(s, start, start + 600001, "next")).toBe(start + 900000);
});
it("skips a missing spring wall time and selects the first autumn fold once", () => {
	expect(new Date(scheduleAt(daily("02:30"), 0, at("2026-03-08T00:00:00Z"), "next")).toISOString()).toBe("2026-03-09T06:30:00.000Z");
	const fall = daily("01:30");
	expect(scheduleAt(fall, 0, at("2026-11-01T00:00:00Z"), "next")).toBe(at("2026-11-01T05:30:00Z"));
	expect(scheduleAt(fall, 0, at("2026-11-01T05:30:00Z"), "next")).toBe(at("2026-11-02T06:30:00Z"));
	expect(scheduleAt(fall, 0, at("2026-11-01T06:45:00Z"), "previous")).toBe(at("2026-11-01T05:30:00Z"));
});
it("handles weekly weekdays, fractional offsets and a thirty-minute DST gap", () => {
	expect(scheduleAt({ kind: "weekly", time: "09:00", timezone: "Asia/Kathmandu", weekday: 1 }, 0, at("2026-10-20T00:00:00Z"), "next")).toBe(
		at("2026-10-26T03:15:00Z"),
	);
	expect(scheduleAt(daily("02:15", "Australia/Lord_Howe"), 0, at("2026-10-03T15:00:00Z"), "next")).toBe(at("2026-10-04T15:15:00Z"));
	expect(() => scheduleAt(daily("09:00", "Invalid/Zone"), 0, Date.now(), "next")).toThrow("IANA");
});
it("skips a weekly DST gap all the way to the following week", () => {
	const schedule = { kind: "weekly" as const, time: "02:30", timezone: "America/New_York", weekday: 7 };
	expect(scheduleAt(schedule, 0, Date.parse("2026-03-02T00:00:00Z"), "next")).toBe(Date.parse("2026-03-15T06:30:00Z"));
});

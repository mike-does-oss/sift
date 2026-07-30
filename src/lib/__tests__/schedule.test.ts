import { describe, it, expect } from "vitest";
import { mostRecentOccurrence, isScheduleDue } from "../schedule";

const at = (iso: string) => new Date(iso);

describe("mostRecentOccurrence", () => {
  it("daily: today if hour passed", () => {
    expect(mostRecentOccurrence({ cadence: "daily", hourUtc: 9, dayOfWeek: null }, at("2026-07-07T10:00:00Z")))
      .toEqual(at("2026-07-07T09:00:00Z"));
  });
  it("daily: yesterday if hour not reached", () => {
    expect(mostRecentOccurrence({ cadence: "daily", hourUtc: 9, dayOfWeek: null }, at("2026-07-07T08:00:00Z")))
      .toEqual(at("2026-07-06T09:00:00Z"));
  });
  it("weekly: this week's day if passed", () => {
    // 2026-07-07 is a Tuesday (dow 2)
    expect(mostRecentOccurrence({ cadence: "weekly", hourUtc: 9, dayOfWeek: 1 }, at("2026-07-07T10:00:00Z")))
      .toEqual(at("2026-07-06T09:00:00Z"));
  });
  it("weekly: last week's day if not reached yet", () => {
    expect(mostRecentOccurrence({ cadence: "weekly", hourUtc: 9, dayOfWeek: 3 }, at("2026-07-07T10:00:00Z")))
      .toEqual(at("2026-07-01T09:00:00Z"));
  });
});

describe("isScheduleDue", () => {
  const base = { cadence: "daily" as const, hourUtc: 9, dayOfWeek: null };
  it("due when never run and occurrence passed", () => {
    expect(isScheduleDue({ ...base, lastRunAt: null }, at("2026-07-07T09:30:00Z"))).toBe(true);
  });
  it("not due when already ran after occurrence", () => {
    expect(isScheduleDue({ ...base, lastRunAt: at("2026-07-07T09:05:00Z") }, at("2026-07-07T10:00:00Z"))).toBe(false);
  });
  it("due again next day", () => {
    expect(isScheduleDue({ ...base, lastRunAt: at("2026-07-06T09:05:00Z") }, at("2026-07-07T09:30:00Z"))).toBe(true);
  });
});

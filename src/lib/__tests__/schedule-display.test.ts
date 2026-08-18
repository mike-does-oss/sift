import { describe, it, expect } from "vitest";
import { utcHourLabel, localHourLabel, hourWithLocalHint, scheduleSentence } from "../schedule-display";

describe("localHourLabel", () => {
  it("shifts east of UTC (AEST +10)", () => {
    expect(localHourLabel(9, 600)).toBe("19:00");
  });
  it("shifts west of UTC and wraps under midnight (PDT -7)", () => {
    expect(localHourLabel(3, -420)).toBe("20:00");
  });
  it("wraps past midnight going east", () => {
    expect(localHourLabel(23, 600)).toBe("09:00");
  });
  it("handles half-hour offsets (IST +5:30)", () => {
    expect(localHourLabel(9, 330)).toBe("14:30");
  });
  it("is null on UTC itself — no redundant hint", () => {
    expect(localHourLabel(9, 0)).toBeNull();
  });
});

describe("hourWithLocalHint", () => {
  it("appends the viewer's local time", () => {
    expect(hourWithLocalHint(9, 600)).toBe("09:00 UTC (19:00 your time)");
  });
  it("stays bare UTC for a UTC viewer", () => {
    expect(hourWithLocalHint(9, 0)).toBe("09:00 UTC");
  });
  it("zero-pads", () => {
    expect(utcHourLabel(7)).toBe("07:00 UTC");
  });
});

describe("scheduleSentence", () => {
  it("reads daily cadence as a sentence", () => {
    expect(scheduleSentence({ cadence: "daily", hourUtc: 9, dayOfWeek: null }, 600)).toBe(
      "Every day at 09:00 UTC (19:00 your time)"
    );
  });
  it("reads weekly cadence with the day name", () => {
    expect(scheduleSentence({ cadence: "weekly", hourUtc: 6, dayOfWeek: 1 }, 0)).toBe("Every Monday at 06:00 UTC");
  });
  it("defaults a missing weekly day to Sunday (matching the old describeCadence)", () => {
    expect(scheduleSentence({ cadence: "weekly", hourUtc: 6, dayOfWeek: null }, 0)).toBe("Every Sunday at 06:00 UTC");
  });
});

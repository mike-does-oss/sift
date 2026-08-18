/**
 * Pure copy helpers for schedule cadence lines (schedule cards + the schedule
 * detail header). Schedules store their hour in UTC; these render it as a
 * readable sentence — "Every day at 09:00 UTC (19:00 your time)" — with the
 * viewer's local time as a parenthetical hint. The UTC→local conversion is
 * parameterized on an offset in minutes (what the caller reads from
 * `-new Date().getTimezoneOffset()`) so it stays deterministic under test.
 */

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "09:00 UTC" */
export function utcHourLabel(hourUtc: number): string {
  return `${String(hourUtc).padStart(2, "0")}:00 UTC`;
}

/**
 * "19:00" — `hourUtc` shifted by `offsetMinutes` (minutes east of UTC, i.e.
 * `-new Date().getTimezoneOffset()`), wrapped into 0–23h. Returns null when
 * the offset is zero: "(09:00 your time)" next to "09:00 UTC" is noise.
 */
export function localHourLabel(hourUtc: number, offsetMinutes: number): string | null {
  if (offsetMinutes === 0) return null;
  const total = (((hourUtc * 60 + offsetMinutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** "09:00 UTC (19:00 your time)" — the local hint only when the viewer isn't on UTC. */
export function hourWithLocalHint(hourUtc: number, offsetMinutes: number): string {
  const local = localHourLabel(hourUtc, offsetMinutes);
  return local ? `${utcHourLabel(hourUtc)} (${local} your time)` : utcHourLabel(hourUtc);
}

/** "Every day at 09:00 UTC (19:00 your time)" / "Every Monday at 06:00 UTC". */
export function scheduleSentence(
  schedule: { cadence: "daily" | "weekly"; hourUtc: number; dayOfWeek: number | null },
  offsetMinutes: number
): string {
  const time = hourWithLocalHint(schedule.hourUtc, offsetMinutes);
  if (schedule.cadence === "daily") return `Every day at ${time}`;
  return `Every ${DAY_NAMES[schedule.dayOfWeek ?? 0]} at ${time}`;
}

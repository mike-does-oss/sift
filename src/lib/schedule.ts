interface ScheduleTiming {
  cadence: "daily" | "weekly";
  hourUtc: number;
  dayOfWeek: number | null; // 0=Sunday..6
}

export function mostRecentOccurrence(s: ScheduleTiming, now: Date): Date {
  const occ = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), s.hourUtc));
  if (s.cadence === "daily") {
    if (occ > now) occ.setUTCDate(occ.getUTCDate() - 1);
    return occ;
  }
  const target = s.dayOfWeek ?? 0;
  const diff = (now.getUTCDay() - target + 7) % 7;
  occ.setUTCDate(occ.getUTCDate() - diff);
  if (occ > now) occ.setUTCDate(occ.getUTCDate() - 7);
  return occ;
}

export function isScheduleDue(s: ScheduleTiming & { lastRunAt: Date | null }, now: Date): boolean {
  const occ = mostRecentOccurrence(s, now);
  return s.lastRunAt === null || s.lastRunAt < occ;
}

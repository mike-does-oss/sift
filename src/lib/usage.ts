import { and, eq, gte, sql, count, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { isHosted } from "@/lib/profile";

// Hosted-profile usage metering (§SaaS-1 T5, donor: extracto-app). A user's
// monthly usage is the number of their jobs created since the start of the
// current UTC month that did NOT run on a bring-your-own key (`usedByoKey`
// is frozen on the row at enqueue — BYO extractions are quota-exempt).
//
// Pg-only by construction: `date_trunc`/`now()` are Postgres, and the local
// profile is unmetered — `getMonthlyUsage` short-circuits to 0 there and no
// gate ever fires for the synthetic "local" plan anyway.

/** The month-window filter, exported for SQL-shape tests. */
export function monthlyUsageFilter(userId: string): SQL {
  return and(
    eq(jobs.userId, userId),
    eq(jobs.usedByoKey, false),
    gte(jobs.createdAt, sql`date_trunc('month', now())`)
  )!;
}

export async function getMonthlyUsage(userId: string): Promise<number> {
  if (!isHosted()) return 0;
  const [row] = await db
    .select({ n: count() })
    .from(jobs)
    .where(monthlyUsageFilter(userId));
  return row?.n ?? 0;
}

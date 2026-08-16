import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { PgDialect } from "drizzle-orm/pg-core";

// §SaaS-1 T5 metering. The hosted count can't run without a live Postgres
// (§T7), so these tests pin the SHAPE of the month-window filter — user
// scoping, BYO exemption, and the server-side date_trunc month window — plus
// the local profile's unmetered short-circuit.

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("monthlyUsageFilter (hosted)", () => {
  it("counts only this user's non-BYO jobs created since the start of the current month", async () => {
    vi.stubEnv("SIFT_PROFILE", "hosted");
    vi.stubEnv("DATABASE_URL", ""); // @/db stays lazy — nothing executes SQL
    const { monthlyUsageFilter } = await import("../usage");
    const q = new PgDialect().sqlToQuery(monthlyUsageFilter("user-1"));
    expect(q.sql).toMatch(/"jobs"\."user_id" = \$\d+/);
    expect(q.sql).toMatch(/"jobs"\."used_byo_key" = \$\d+/);
    expect(q.sql).toMatch(/"jobs"\."created_at" >= date_trunc\('month', now\(\)\)/);
    expect(q.params).toEqual(["user-1", false]);
  });
});

describe("getMonthlyUsage (local)", () => {
  it("short-circuits to 0 — the local profile is unmetered", async () => {
    vi.stubEnv("SIFT_PROFILE", "");
    vi.stubEnv("SIFT_DATA_DIR", mkdtempSync(path.join(tmpdir(), "sift-t5-usage-")));
    const { getMonthlyUsage } = await import("../usage");
    expect(await getMonthlyUsage("local")).toBe(0);
  });
});

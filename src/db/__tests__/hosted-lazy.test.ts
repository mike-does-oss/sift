import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Under SIFT_PROFILE=hosted the db module must do NO import-time work: no
// neon client construction, no DATABASE_URL check, no migrate. The missing
// DATABASE_URL may only blow up on first actual use of `db` (T7 provisions
// the real env; builds must be able to import `@/db` without it).
describe("db under the hosted profile", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("SIFT_PROFILE", "hosted");
    vi.stubEnv("DATABASE_URL", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("imports without DATABASE_URL; throws only on first db use", async () => {
    const mod = await import("@/db");
    // Import succeeded; touching the lazy proxy is what triggers construction.
    expect(() => mod.db.select).toThrow(/DATABASE_URL/);
  });

  it("getSqlite() throws a clear hosted-profile error", async () => {
    const mod = await import("@/db");
    expect(() => mod.getSqlite()).toThrow(/local-profile only/);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";

// getJobStore() must pick the dialect from the profile flag: raw-sqlite
// locally, single-statement pg on hosted. The stores are dynamic imports, so
// selecting one must not load the other (loading store.local on hosted would
// throw via getSqlite()).
describe("job store selection by profile", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("selects the pg store on the hosted profile (without touching DATABASE_URL)", async () => {
    vi.stubEnv("SIFT_PROFILE", "hosted");
    vi.stubEnv("DATABASE_URL", "");
    const { getJobStore } = await import("../core");
    const store = await getJobStore();
    expect(store.dialect).toBe("pg");
    // pg is multi-instance: no in-process bookkeeping, but it must sweep.
    expect(store.beginRun).toBeUndefined();
    expect(store.sweepStale).toBeTypeOf("function");
    // Output flows are local-only; the pg store must not implement them.
    expect(store.runTerminalCounts).toBeUndefined();
    expect(store.clearBatchResults).toBeUndefined();
    expect(store.clearRunResults).toBeUndefined();
  });

  it("selects the sqlite store on the local profile", async () => {
    vi.stubEnv("SIFT_PROFILE", "");
    vi.stubEnv("SIFT_DATA_DIR", mkdtempSync(path.join(tmpdir(), "sift-t3-select-")));
    const { getJobStore } = await import("../core");
    const store = await getJobStore();
    expect(store.dialect).toBe("sqlite");
    expect(store.beginRun).toBeTypeOf("function");
    expect(store.sweepStale).toBeUndefined();
    expect(store.runTerminalCounts).toBeTypeOf("function");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

// Review round: `pgStore.sweepStale` must (a) keep the existing batch
// failed_count rollup for every swept batch job and (b) RETURN the swept
// rows' (batchId, runId, scheduleId) so the core can fire the run-delivery
// hook for runs the sweep just made all-terminal.

const execute = vi.fn();

vi.mock("@/db", () => ({
  db: { execute },
  getSqlite: () => {
    throw new Error("no sqlite in this test");
  },
}));

const dialect = new PgDialect();
const sqlOfCall = (i: number) => dialect.sqlToQuery(execute.mock.calls[i][0] as SQL);

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("SIFT_PROFILE", "hosted");
  vi.stubEnv("DATABASE_URL", "");
  execute.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("pgStore.sweepStale", () => {
  it("returns the swept rows' identity (camelCased) and rolls failed_count forward per swept batch job", async () => {
    execute
      .mockResolvedValueOnce({
        rows: [
          { batch_id: "b1", run_id: null, schedule_id: null },
          { batch_id: null, run_id: "run_1", schedule_id: "sch_1" },
          { batch_id: null, run_id: "run_1", schedule_id: "sch_1" },
        ],
      })
      .mockResolvedValue({ rows: [] });
    const { pgStore } = await import("../store.pg");
    const swept = await pgStore.sweepStale!();
    expect(swept).toEqual([
      { batchId: "b1", runId: null, scheduleId: null },
      { batchId: null, runId: "run_1", scheduleId: "sch_1" },
      { batchId: null, runId: "run_1", scheduleId: "sch_1" },
    ]);
    // Sweep statement first, then exactly ONE increment (only the batch job).
    expect(execute).toHaveBeenCalledTimes(2);
    expect(sqlOfCall(0).sql).toContain("RETURNING batch_id, run_id, schedule_id");
    const increment = sqlOfCall(1);
    expect(increment.sql).toContain("UPDATE batches SET failed_count = failed_count + 1");
    expect(increment.params).toEqual(["b1"]);
  });

  it("an empty sweep issues no increments and returns []", async () => {
    execute.mockResolvedValue({ rows: [] });
    const { pgStore } = await import("../store.pg");
    expect(await pgStore.sweepStale!()).toEqual([]);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

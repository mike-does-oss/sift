import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// §INBOX T2: `enqueueScheduleArrival` is the on-arrival entry point — the
// same quota-capped enqueue as `enqueueScheduleNow`, minus the `lastRunAt`
// stamp. These tests pin exactly that contract on hosted:
//   - arrival enqueue NEVER touches lastRunAt (the cadence digest stays
//     meaningful — a stamped lastRunAt would swallow the next cadence run)
//   - enqueueScheduleNow still stamps it (the contrast lock)
//   - downgrade-skip: an owner whose plan lost schedules enqueues nothing
//   - the §T8 quota cap still applies on the arrival path

const schedulesFindFirst = vi.hoisted(() => vi.fn());
const templatesFindFirst = vi.hoisted(() => vi.fn());
const dbUpdate = vi.hoisted(() =>
  vi.fn(() => ({ set: () => ({ where: async () => undefined }) })));
vi.mock("@/db", () => ({
  db: {
    query: {
      schedules: { findFirst: schedulesFindFirst },
      templates: { findFirst: templatesFindFirst },
    },
    update: dbUpdate,
  },
  getSqlite: () => { throw new Error("no sqlite in this test"); },
}));

const getDbUserById = vi.hoisted(() => vi.fn());
vi.mock("@/lib/user", () => ({ getDbUserById }));

const getMonthlyUsage = vi.hoisted(() => vi.fn());
vi.mock("@/lib/usage", () => ({ getMonthlyUsage }));

const pgEnqueue = vi.hoisted(() => vi.fn(async (...args: unknown[]) => { void args; return 2; }));
vi.mock("../store.pg", () => ({ pgStore: { dialect: "pg", enqueueInbox: pgEnqueue } }));

// `business` is the only plan with schedules — the owner an arrival enqueue
// normally serves.
const SCHEDULE = { id: "s1", userId: "u1", templateId: "t1" };
const TEMPLATE = { id: "t1", userId: "u1", fields: [{ id: "f1", name: "total", type: "number" }], prompt: "", extractMultiple: false, examples: null };

beforeEach(() => {
  vi.resetModules();
  schedulesFindFirst.mockResolvedValue(SCHEDULE);
  templatesFindFirst.mockResolvedValue(TEMPLATE);
  getDbUserById.mockReset().mockResolvedValue({ plan: "business", encryptedAnthropicKey: null });
  getMonthlyUsage.mockReset().mockResolvedValue(0);
  dbUpdate.mockClear();
  pgEnqueue.mockClear();
  vi.stubEnv("SIFT_PROFILE", "hosted");
  vi.stubEnv("DATABASE_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("enqueueScheduleArrival (hosted)", () => {
  it("enqueues through the store but NEVER touches lastRunAt", async () => {
    const { enqueueScheduleArrival } = await import("../core");
    expect(await enqueueScheduleArrival("s1")).toBe(2);
    expect(pgEnqueue).toHaveBeenCalledTimes(1);
    // The whole point of the arrival entry point: no db.update at all, so
    // `lastRunAt` keeps its cadence meaning (isScheduleDue compares it to the
    // most recent scheduled occurrence).
    expect(dbUpdate).not.toHaveBeenCalled();
  });

  it("contrast lock: enqueueScheduleNow still stamps lastRunAt", async () => {
    const { enqueueScheduleNow } = await import("../core");
    expect(await enqueueScheduleNow("s1")).toBe(2);
    expect(dbUpdate).toHaveBeenCalledTimes(1);
  });

  it("downgrade-skip: an owner whose plan no longer includes schedules enqueues nothing", async () => {
    getDbUserById.mockResolvedValue({ plan: "pro", encryptedAnthropicKey: null }); // pro has no schedules
    const { enqueueScheduleArrival } = await import("../core");
    expect(await enqueueScheduleArrival("s1")).toBe(0);
    expect(pgEnqueue).not.toHaveBeenCalled();
    expect(dbUpdate).not.toHaveBeenCalled();
  });

  it("a vanished schedule enqueues nothing", async () => {
    schedulesFindFirst.mockResolvedValue(undefined);
    const { enqueueScheduleArrival } = await import("../core");
    expect(await enqueueScheduleArrival("s1")).toBe(0);
    expect(pgEnqueue).not.toHaveBeenCalled();
  });

  it("the §T8 quota cap applies on the arrival path too", async () => {
    getMonthlyUsage.mockResolvedValue(4996); // business limit 5000 → 4 remaining
    const { enqueueScheduleArrival } = await import("../core");
    expect(await enqueueScheduleArrival("s1")).toBe(2);
    const [, , , usedByoKey, quotaLimit] = pgEnqueue.mock.calls[0];
    expect(usedByoKey).toBe(false);
    expect(quotaLimit).toBe(4);
    expect(dbUpdate).not.toHaveBeenCalled();
  });
});

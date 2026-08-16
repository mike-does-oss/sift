import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// §T8 final-review fix: schedule enqueue takes the quota gate. These tests
// pin core.enqueueInbox's decisions (via enqueueScheduleNow) on hosted:
//   - non-BYO owner over quota  → 0 jobs, store never called
//   - non-BYO owner under quota → store called with quotaLimit = remaining
//   - BYO owner                 → store called with quotaLimit = null (exempt)

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

const pgEnqueue = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => 3));
vi.mock("../store.pg", () => ({ pgStore: { dialect: "pg", enqueueInbox: pgEnqueue } }));

const SCHEDULE = { id: "s1", userId: "u1", templateId: "t1" };
const TEMPLATE = { id: "t1", userId: "u1", fields: [{ id: "f1", name: "total", type: "number" }], prompt: "", extractMultiple: false, examples: null };

beforeEach(() => {
  vi.resetModules();
  schedulesFindFirst.mockResolvedValue(SCHEDULE);
  templatesFindFirst.mockResolvedValue(TEMPLATE);
  getDbUserById.mockReset();
  getMonthlyUsage.mockReset();
  pgEnqueue.mockClear();
  vi.stubEnv("SIFT_PROFILE", "hosted");
  vi.stubEnv("DATABASE_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("schedule enqueue quota cap (hosted)", () => {
  it("owner over quota → 0 jobs, store never touched", async () => {
    getDbUserById.mockResolvedValue({ plan: "free", encryptedAnthropicKey: null });
    getMonthlyUsage.mockResolvedValue(10); // free limit is 10
    const { enqueueScheduleNow } = await import("../core");
    expect(await enqueueScheduleNow("s1")).toBe(0);
    expect(pgEnqueue).not.toHaveBeenCalled();
  });

  it("owner under quota → store capped at exactly the remaining quota", async () => {
    getDbUserById.mockResolvedValue({ plan: "pro", encryptedAnthropicKey: null });
    getMonthlyUsage.mockResolvedValue(994); // pro limit 1000 → 6 remaining
    const { enqueueScheduleNow } = await import("../core");
    expect(await enqueueScheduleNow("s1")).toBe(3);
    expect(pgEnqueue).toHaveBeenCalledTimes(1);
    const [, , , usedByoKey, quotaLimit] = pgEnqueue.mock.calls[0];
    expect(usedByoKey).toBe(false);
    expect(quotaLimit).toBe(6);
  });

  it("BYO owner → uncapped and stamped BYO, usage never read", async () => {
    getDbUserById.mockResolvedValue({ plan: "pro", encryptedAnthropicKey: "enc" });
    const { enqueueScheduleNow } = await import("../core");
    expect(await enqueueScheduleNow("s1")).toBe(3);
    const [, , , usedByoKey, quotaLimit] = pgEnqueue.mock.calls[0];
    expect(usedByoKey).toBe(true);
    expect(quotaLimit).toBeNull();
    expect(getMonthlyUsage).not.toHaveBeenCalled();
  });
});

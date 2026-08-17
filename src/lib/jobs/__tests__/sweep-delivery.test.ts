import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobStore } from "../core";

// Review round (§INBOX T2): a stale sweep is a terminal transition, so a run
// whose LAST live job is swept must still fire the delivery hook — otherwise
// its digest + dataset append are permanently lost (no job of the run ever
// transitions again). These tests drive `processPendingJobs`' sweep call
// site: one delivery fire per DISTINCT swept run, claim idempotency intact,
// no fire for runless (batch/single) swept jobs, and a sweep failure stays
// contained.

const state = vi.hoisted(() => ({
  schedulesFindFirst: vi.fn(),
  jobRows: [] as unknown[],
  sendEmail: vi.fn(),
  getDbUserById: vi.fn(),
  store: null as unknown as JobStore,
}));

vi.mock("@/db", () => ({
  db: {
    query: {
      schedules: { findFirst: state.schedulesFindFirst },
      datasets: { findFirst: vi.fn() },
    },
    select: () => ({ from: () => ({ leftJoin: () => ({ where: async () => state.jobRows }) }) }),
    insert: () => ({ values: () => Promise.resolve() }),
  },
  getSqlite: () => {
    throw new Error("no sqlite in this test");
  },
}));

vi.mock("@/lib/user", () => ({ getDbUserById: state.getDbUserById }));
vi.mock("@/lib/resend", () => ({ sendEmail: state.sendEmail }));
// getJobStore's hosted arm must hand back OUR store — the sweep call site is
// what's under test, not the real pg statements.
vi.mock("../store.pg", () => ({
  get pgStore() {
    return state.store;
  },
}));

function makeStore(overrides: Partial<JobStore> = {}): JobStore {
  return {
    dialect: "pg",
    claimOne: vi.fn(async () => null), // no runnable work — isolates the sweep phase
    countRemaining: vi.fn(async () => 0),
    incrementBatchCompleted: vi.fn(),
    incrementBatchFailed: vi.fn(),
    enqueueInbox: vi.fn(),
    sweepStale: vi.fn(async () => []),
    runTerminalCounts: vi.fn(async () => ({ total: 1, terminal: 1 })),
    claimRunDelivery: vi.fn(async () => true),
    ...overrides,
  };
}

async function process(store: JobStore) {
  state.store = store;
  const { processPendingJobs } = await import("../core");
  return processPendingJobs(1000);
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("SIFT_PROFILE", "hosted");
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("RESEND_INBOUND_DOMAIN", "in.sift.example");
  state.schedulesFindFirst.mockReset().mockResolvedValue({
    id: "sch_1",
    userId: "u1",
    name: "Invoices inbox",
    datasetId: null,
    notifyEmail: true,
  });
  state.jobRows = [{ job: { status: "failed", result: null, error: "Worker timed out", templateSnapshot: { fields: [], prompt: "", extractMultiple: false } }, filename: "a.pdf" }];
  state.sendEmail.mockReset().mockResolvedValue(undefined);
  state.getDbUserById.mockReset().mockResolvedValue({ id: "u1", email: "owner@example.com" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("sweep call site fires run delivery", () => {
  it("fires the delivery hook once per DISTINCT swept run", async () => {
    const store = makeStore({
      sweepStale: vi.fn(async () => [
        { batchId: null, runId: "run_1", scheduleId: "sch_1" },
        { batchId: null, runId: "run_1", scheduleId: "sch_1" }, // same run, two swept jobs
        { batchId: "b1", runId: "run_2", scheduleId: "sch_1" },
      ]),
    });
    await process(store);
    expect(store.claimRunDelivery).toHaveBeenCalledTimes(2);
    expect(store.claimRunDelivery).toHaveBeenCalledWith("run_1");
    expect(store.claimRunDelivery).toHaveBeenCalledWith("run_2");
    expect(state.sendEmail).toHaveBeenCalledTimes(2);
  });

  it("a lost delivery claim (already delivered elsewhere) sends nothing — double-fires are safe", async () => {
    const store = makeStore({
      sweepStale: vi.fn(async () => [{ batchId: null, runId: "run_1", scheduleId: "sch_1" }]),
      claimRunDelivery: vi.fn(async () => false),
    });
    await process(store);
    expect(store.claimRunDelivery).toHaveBeenCalledTimes(1);
    expect(state.sendEmail).not.toHaveBeenCalled();
  });

  it("does not fire until the swept run is actually all-terminal", async () => {
    const store = makeStore({
      sweepStale: vi.fn(async () => [{ batchId: null, runId: "run_1", scheduleId: "sch_1" }]),
      runTerminalCounts: vi.fn(async () => ({ total: 3, terminal: 2 })),
    });
    await process(store);
    expect(store.claimRunDelivery).not.toHaveBeenCalled();
    expect(state.sendEmail).not.toHaveBeenCalled();
  });

  it("swept batch/single jobs (no runId) never touch the delivery hook", async () => {
    const store = makeStore({
      sweepStale: vi.fn(async () => [{ batchId: "b1", runId: null, scheduleId: null }]),
    });
    await process(store);
    expect(store.runTerminalCounts).not.toHaveBeenCalled();
    expect(store.claimRunDelivery).not.toHaveBeenCalled();
  });

  it("an empty sweep fires nothing", async () => {
    const store = makeStore();
    await process(store);
    expect(store.claimRunDelivery).not.toHaveBeenCalled();
    expect(state.sendEmail).not.toHaveBeenCalled();
  });

  it("a sweep failure is contained — the worker still reports cleanly", async () => {
    const store = makeStore({ sweepStale: vi.fn(async () => { throw new Error("sweep exploded"); }) });
    await expect(process(store)).resolves.toEqual({ processed: 0, remaining: 0 });
    expect(state.sendEmail).not.toHaveBeenCalled();
  });
});

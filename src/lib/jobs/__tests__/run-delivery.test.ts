import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { JobStore, Snapshot } from "../core";

// §INBOX T2: `deliverRunResultsIfDone` — the hosted all-terminal hook for
// schedule runs. These tests pin: the all-terminal gate, single delivery via
// the store's insert-claim, the dataset-append leg (ownership + header-match
// + projection), the digest leg (counts, failure truncation, CSV size gate,
// env/email skips), and the donor best-effort convention (one leg's failure
// never blocks the other, and nothing ever throws out of the hook).

const state = vi.hoisted(() => ({
  schedulesFindFirst: vi.fn(),
  datasetsFindFirst: vi.fn(),
  jobRows: [] as unknown[],
  inserted: [] as Array<Record<string, unknown>>,
  insertImpl: null as null | (() => Promise<void>),
  sendEmail: vi.fn(),
  getDbUserById: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    query: {
      schedules: { findFirst: state.schedulesFindFirst },
      datasets: { findFirst: state.datasetsFindFirst },
    },
    select: () => ({ from: () => ({ leftJoin: () => ({ where: async () => state.jobRows }) }) }),
    insert: () => ({
      values: (v: Array<Record<string, unknown>>) => {
        if (state.insertImpl) return state.insertImpl();
        state.inserted.push(...v);
        return Promise.resolve();
      },
    }),
  },
  getSqlite: () => { throw new Error("no sqlite in this test"); },
}));

vi.mock("@/lib/user", () => ({ getDbUserById: state.getDbUserById }));
vi.mock("@/lib/resend", () => ({ sendEmail: state.sendEmail }));

const SNAPSHOT: Snapshot = {
  fields: [
    { id: "f1", name: "vendor", type: "text" },
    { id: "f2", name: "total", type: "number" },
  ],
  prompt: "",
  extractMultiple: false,
};

const SCHEDULE = {
  id: "sch_1",
  userId: "u1",
  name: "Invoices inbox",
  datasetId: "ds_1",
  notifyEmail: true,
};

const DATASET = { id: "ds_1", userId: "u1", headers: ["vendor", "total"] };

function completedJob(filename: string, result: unknown) {
  return { job: { status: "completed", result, error: null, templateSnapshot: SNAPSHOT }, filename };
}
function failedJob(filename: string, error: string) {
  return { job: { status: "failed", result: null, error, templateSnapshot: SNAPSHOT }, filename };
}

function makeStore(overrides: Partial<JobStore> = {}): JobStore {
  return {
    dialect: "pg",
    claimOne: vi.fn(),
    countRemaining: vi.fn(),
    incrementBatchCompleted: vi.fn(),
    incrementBatchFailed: vi.fn(),
    enqueueInbox: vi.fn(),
    runTerminalCounts: vi.fn(async () => ({ total: 2, terminal: 2 })),
    claimRunDelivery: vi.fn(async () => true),
    ...overrides,
  };
}

const JOB = { runId: "run_1", scheduleId: "sch_1" };

async function deliver(store: JobStore, job: { runId: string | null; scheduleId: string | null } = JOB) {
  const { deliverRunResultsIfDone } = await import("../core");
  await deliverRunResultsIfDone(store, job);
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("SIFT_PROFILE", "hosted");
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("RESEND_INBOUND_DOMAIN", "in.sift.example");
  vi.stubEnv("APP_URL", "https://sift.example");
  state.schedulesFindFirst.mockReset().mockResolvedValue({ ...SCHEDULE });
  state.datasetsFindFirst.mockReset().mockResolvedValue({ ...DATASET });
  state.jobRows = [
    completedJob("a.pdf", { vendor: "Acme", total: 10 }),
    completedJob("b.pdf", { vendor: "Globex", total: 20 }),
  ];
  state.inserted.length = 0;
  state.insertImpl = null;
  state.sendEmail.mockReset().mockResolvedValue(undefined);
  state.getDbUserById.mockReset().mockResolvedValue({ id: "u1", email: "owner@example.com" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("gating", () => {
  it("does nothing on the local profile", async () => {
    vi.stubEnv("SIFT_PROFILE", "");
    const store = makeStore();
    await deliver(store);
    expect(store.runTerminalCounts).not.toHaveBeenCalled();
    expect(state.sendEmail).not.toHaveBeenCalled();
  });

  it("does nothing without a runId (single/batch jobs)", async () => {
    const store = makeStore();
    await deliver(store, { runId: null, scheduleId: "sch_1" });
    expect(store.runTerminalCounts).not.toHaveBeenCalled();
  });

  it("does nothing until every job of the run is terminal — the claim is never attempted early", async () => {
    const store = makeStore({ runTerminalCounts: vi.fn(async () => ({ total: 3, terminal: 2 })) });
    await deliver(store);
    expect(store.claimRunDelivery).not.toHaveBeenCalled();
    expect(state.sendEmail).not.toHaveBeenCalled();
    expect(state.inserted).toEqual([]);
  });
});

describe("idempotency (single delivery per run)", () => {
  it("a lost claim means no delivery work at all", async () => {
    const store = makeStore({ claimRunDelivery: vi.fn(async () => false) });
    await deliver(store);
    expect(state.schedulesFindFirst).not.toHaveBeenCalled();
    expect(state.sendEmail).not.toHaveBeenCalled();
    expect(state.inserted).toEqual([]);
  });

  it("two racing terminal transitions → exactly one delivery (conflict-claim semantics)", async () => {
    // The store's claim resolves true exactly once — the ON CONFLICT DO
    // NOTHING contract both dialect implementations provide.
    let claimed = false;
    const store = makeStore({
      claimRunDelivery: vi.fn(async () => {
        if (claimed) return false;
        claimed = true;
        return true;
      }),
    });
    await Promise.all([deliver(store), deliver(store)]);
    expect(state.sendEmail).toHaveBeenCalledTimes(1);
    expect(state.inserted).toHaveLength(2); // one delivery's rows, not two
  });
});

describe("dataset auto-append", () => {
  it("appends completed rows projected onto the dataset's headers (extra jobsToRows columns dropped)", async () => {
    await deliver(makeStore());
    expect(state.inserted).toEqual([
      { userId: "u1", datasetId: "ds_1", row: { vendor: "Acme", total: 10 }, sourceJobId: null },
      { userId: "u1", datasetId: "ds_1", row: { vendor: "Globex", total: 20 }, sourceJobId: null },
    ]);
    // Ownership was part of the lookup, not an afterthought.
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const where = state.datasetsFindFirst.mock.calls[0][0].where;
    expect(new PgDialect().sqlToQuery(where).params).toEqual(["ds_1", "u1"]);
  });

  it("missing (or cross-tenant) dataset → skip, digest still goes out", async () => {
    state.datasetsFindFirst.mockResolvedValue(undefined);
    await deliver(makeStore());
    expect(state.inserted).toEqual([]);
    expect(state.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("header mismatch → skip, digest still goes out", async () => {
    state.datasetsFindFirst.mockResolvedValue({ ...DATASET, headers: ["vendor", "amount"] });
    await deliver(makeStore());
    expect(state.inserted).toEqual([]);
    expect(state.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("no datasetId on the schedule → no dataset lookup", async () => {
    state.schedulesFindFirst.mockResolvedValue({ ...SCHEDULE, datasetId: null });
    await deliver(makeStore());
    expect(state.datasetsFindFirst).not.toHaveBeenCalled();
    expect(state.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("an append failure never blocks the digest (independent best-effort legs)", async () => {
    state.insertImpl = async () => { throw new Error("insert exploded"); };
    await deliver(makeStore());
    expect(state.sendEmail).toHaveBeenCalledTimes(1);
  });
});

describe("digest email", () => {
  it("assembles subject, counts, deep link, and a CSV attachment of the completed rows", async () => {
    await deliver(makeStore());
    expect(state.sendEmail).toHaveBeenCalledTimes(1);
    const email = state.sendEmail.mock.calls[0][0];
    expect(email.to).toBe("owner@example.com");
    expect(email.subject).toBe("Sift: Invoices inbox processed 2 documents");
    expect(email.html).toContain("2 completed");
    expect(email.html).toContain("0 failed");
    expect(email.html).toContain("https://sift.example/dashboard/schedules/sch_1");
    expect(email.attachments).toHaveLength(1);
    expect(email.attachments[0].filename).toBe("Invoices inbox.csv");
    const csv = Buffer.from(email.attachments[0].content, "base64").toString("utf8");
    expect(csv.split("\n")[0]).toBe("_document,vendor,total");
    expect(csv).toContain("a.pdf,Acme,10");
  });

  it("lists at most 5 failed filenames with error one-liners, then 'and X more'", async () => {
    state.jobRows = [
      completedJob("ok.pdf", { vendor: "Acme", total: 1 }),
      ...Array.from({ length: 7 }, (_, i) => failedJob(`bad${i}.pdf`, `boom ${i}\nstack trace line`)),
    ];
    const store = makeStore({ runTerminalCounts: vi.fn(async () => ({ total: 8, terminal: 8 })) });
    await deliver(store);
    const email = state.sendEmail.mock.calls[0][0];
    expect(email.subject).toBe("Sift: Invoices inbox processed 8 documents");
    expect(email.html).toContain("1 completed");
    expect(email.html).toContain("7 failed");
    for (let i = 0; i < 5; i++) expect(email.html).toContain(`bad${i}.pdf — boom ${i}`);
    expect(email.html).not.toContain("bad5.pdf");
    expect(email.html).toContain("and 2 more");
    expect(email.html).not.toContain("stack trace line"); // one-liners only
  });

  it("escapes HTML in schedule names and failure details", async () => {
    state.schedulesFindFirst.mockResolvedValue({ ...SCHEDULE, name: "<b>Bills</b>", datasetId: null });
    state.jobRows = [failedJob("<img>.pdf", "err <script>")];
    const store = makeStore({ runTerminalCounts: vi.fn(async () => ({ total: 1, terminal: 1 })) });
    await deliver(store);
    const email = state.sendEmail.mock.calls[0][0];
    expect(email.html).not.toContain("<b>Bills</b>");
    expect(email.html).toContain("&lt;b&gt;Bills&lt;/b&gt;");
    expect(email.html).toContain("&lt;img&gt;.pdf");
    expect(email.html).toContain("err &lt;script&gt;");
  });

  it("skips the CSV attachment when it would exceed 1MB", async () => {
    state.jobRows = [completedJob("big.pdf", { vendor: "x".repeat(1_100_000), total: 1 })];
    const store = makeStore({ runTerminalCounts: vi.fn(async () => ({ total: 1, terminal: 1 })) });
    await deliver(store);
    const email = state.sendEmail.mock.calls[0][0];
    expect(email.attachments).toBeUndefined();
  });

  it("attaches no CSV when the run completed nothing", async () => {
    state.jobRows = [failedJob("bad.pdf", "boom")];
    const store = makeStore({ runTerminalCounts: vi.fn(async () => ({ total: 1, terminal: 1 })) });
    await deliver(store);
    const email = state.sendEmail.mock.calls[0][0];
    expect(email.attachments).toBeUndefined();
    expect(email.html).toContain("0 completed");
  });

  it("notifyEmail off → no digest (dataset append still runs)", async () => {
    state.schedulesFindFirst.mockResolvedValue({ ...SCHEDULE, notifyEmail: false });
    await deliver(makeStore());
    expect(state.sendEmail).not.toHaveBeenCalled();
    expect(state.inserted).toHaveLength(2);
  });

  it("missing RESEND envs → log-and-skip, never a throw", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    await deliver(makeStore());
    expect(state.sendEmail).not.toHaveBeenCalled();
    expect(state.inserted).toHaveLength(2); // dataset leg unaffected
  });

  it("owner without an email → log-and-skip", async () => {
    state.getDbUserById.mockResolvedValue({ id: "u1", email: "" });
    await deliver(makeStore());
    expect(state.sendEmail).not.toHaveBeenCalled();
  });

  it("a resend failure never escapes the hook", async () => {
    state.sendEmail.mockRejectedValue(new Error("resend down"));
    await expect(deliver(makeStore())).resolves.toBeUndefined();
    expect(state.inserted).toHaveLength(2);
  });
});

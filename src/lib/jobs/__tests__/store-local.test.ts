import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import type { JobStore, Snapshot } from "../core";

// Behavior lock on the refactor (§SaaS-1 T3): the raw-sqlite store moved from
// src/lib/jobs.ts into store.local.ts must keep the historical claim/enqueue
// semantics exactly. Runs against a scratch SIFT_DATA_DIR.

type Db = typeof import("@/db").db;
type Schema = typeof import("@/db/schema");

let store: JobStore;
let db: Db;
let schema: Schema;

const snapshot: Snapshot = { fields: [{ id: "f1", name: "total", type: "number" }], prompt: "", extractMultiple: false };

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("SIFT_PROFILE", "");
  vi.stubEnv("SIFT_DATA_DIR", mkdtempSync(path.join(tmpdir(), "sift-t3-local-")));
  const core = await import("../core");
  store = await core.getJobStore();
  ({ db } = await import("@/db"));
  schema = await import("@/db/schema");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("local store claim", () => {
  it("claims a pending job, flipping it to processing and bumping attempts", async () => {
    await db.insert(schema.jobs).values({ id: "j1", templateSnapshot: snapshot, source: "single" });
    expect(await store.claimOne()).toBe("j1");
    const row = await db.query.jobs.findFirst();
    expect(row?.status).toBe("processing");
    expect(row?.attempts).toBe(1);
    // Nothing left to claim.
    expect(await store.claimOne()).toBeNull();
  });

  it("re-claims a stale processing job only when it is not in flight in this process", async () => {
    await db.insert(schema.jobs).values({
      id: "j2", templateSnapshot: snapshot, source: "single",
      status: "processing", attempts: 1, startedAt: new Date(Date.now() - 11 * 60_000),
    });
    store.beginRun?.("j2");
    expect(await store.claimOne()).toBeNull(); // in-flight here — not an orphan
    store.endRun?.("j2");
    expect(await store.claimOne()).toBe("j2");
  });

  it("claims retryable failures but never terminal ones", async () => {
    await db.insert(schema.jobs).values([
      { id: "terminal", templateSnapshot: snapshot, source: "single", status: "failed", attempts: 3, completedAt: new Date() },
      { id: "retryable", templateSnapshot: snapshot, source: "single", status: "failed", attempts: 1 },
    ]);
    expect(await store.claimOne()).toBe("retryable");
    expect(await store.claimOne()).toBeNull();
  });

  it("countRemaining counts pending and retryable-failed jobs only", async () => {
    await db.insert(schema.jobs).values([
      { id: "a", templateSnapshot: snapshot, source: "single" }, // pending
      { id: "b", templateSnapshot: snapshot, source: "single", status: "failed", attempts: 2 }, // retryable
      { id: "c", templateSnapshot: snapshot, source: "single", status: "failed", attempts: 3, completedAt: new Date() }, // terminal
      { id: "d", templateSnapshot: snapshot, source: "single", status: "completed", completedAt: new Date() },
    ]);
    expect(await store.countRemaining()).toBe(2);
  });
});

describe("local store enqueueInbox", () => {
  it("creates jobs for unprocessed inbox documents and marks them processed", async () => {
    await db.insert(schema.documents).values([
      { id: "d1", filename: "a.pdf", filePath: "files/a.pdf", sizeBytes: 1, scheduleId: "s1" },
      { id: "d2", filename: "b.pdf", filePath: "files/b.pdf", sizeBytes: 1, scheduleId: "s1" },
      { id: "d3", filename: "c.pdf", filePath: "files/c.pdf", sizeBytes: 1, scheduleId: "s1", processedAt: new Date() },
      { id: "d4", filename: "d.pdf", filePath: "files/d.pdf", sizeBytes: 1, scheduleId: "other" },
    ]);
    const created = await store.enqueueInbox({ id: "s1", userId: "local" }, snapshot, "run-1", false, null);
    expect(created).toBe(2);

    const jobRows = await db.query.jobs.findMany();
    expect(jobRows).toHaveLength(2);
    for (const j of jobRows) {
      expect(j.source).toBe("schedule");
      expect(j.scheduleId).toBe("s1");
      expect(j.runId).toBe("run-1");
      expect(j.userId).toBe("local");
      expect(j.status).toBe("pending");
      expect(j.templateSnapshot).toEqual(snapshot);
      // §T5: byo stamping is a hosted concept — local rows stay false.
      expect(j.usedByoKey).toBe(false);
    }
    expect(new Set(jobRows.map((j) => j.documentId))).toEqual(new Set(["d1", "d2"]));

    // Claimed docs are marked; re-running enqueues nothing.
    expect(await store.enqueueInbox({ id: "s1", userId: "local" }, snapshot, "run-2", false, null)).toBe(0);
  });
});

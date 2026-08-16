import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Snapshot } from "../core";

// The hosted store can't run live without a Postgres (§SaaS-1 T7) — these
// tests pin the SHAPE of its two load-bearing statements instead: the
// multi-instance-safe claim and the atomic claim-and-enqueue CTE.

const dialect = new PgDialect();

beforeAll(() => {
  vi.resetModules();
  // Hosted: keeps the @/db import lazy — nothing here executes SQL.
  vi.stubEnv("SIFT_PROFILE", "hosted");
  vi.stubEnv("DATABASE_URL", "");
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("pg claim statement", () => {
  it("is a single UPDATE over a FOR UPDATE SKIP LOCKED subselect of one job", async () => {
    const { claimSql } = await import("../store.pg");
    const q = dialect.sqlToQuery(claimSql());
    expect(q.sql).toContain("UPDATE jobs SET status = 'processing', started_at = now(), attempts = attempts + 1");
    expect(q.sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(q.sql).toContain("LIMIT 1");
    expect(q.sql).toContain("ORDER BY created_at");
    expect(q.sql).toContain("RETURNING id");
  });

  it("claims exactly the three runnable arms: pending, retryable-failed, stale-processing", async () => {
    const { claimSql } = await import("../store.pg");
    const q = dialect.sqlToQuery(claimSql());
    expect(q.sql).toContain("status = 'pending'");
    expect(q.sql).toMatch(/status = 'failed' AND attempts < \$\d+ AND completed_at IS NULL/);
    expect(q.sql).toMatch(/status = 'processing' AND started_at < now\(\) - interval '10 minutes' AND attempts < \$\d+/);
    // Both attempt caps are MAX_ATTEMPTS.
    expect(q.params).toEqual([3, 3]);
  });
});

describe("pg inbox claim-and-enqueue CTE", () => {
  const schedule = { id: "sched-1", userId: "user-1" };
  const snapshot: Snapshot = { fields: [{ id: "f1", name: "total", type: "number" }], prompt: "p", extractMultiple: false };

  it("claims documents and inserts jobs in ONE statement with explicit ids and timestamps", async () => {
    const { enqueueInboxSql } = await import("../store.pg");
    const q = dialect.sqlToQuery(enqueueInboxSql(schedule, snapshot, "run-1"));
    expect(q.sql).toContain("WITH claimed AS");
    expect(q.sql).toContain("UPDATE documents SET processed_at = now()");
    expect(q.sql).toMatch(/WHERE schedule_id = \$\d+ AND processed_at IS NULL AND user_id = \$\d+/);
    // Raw SQL bypasses drizzle's $defaultFn app-level defaults — id and
    // created_at must be explicit.
    expect(q.sql).toContain("gen_random_uuid()::text");
    expect(q.sql).toContain(
      "INSERT INTO jobs (id, user_id, document_id, template_snapshot, source, schedule_id, run_id, status, attempts, created_at)"
    );
    expect(q.sql).toContain("'pending', 0, now()");
    expect(q.sql).toContain("'schedule'");
    expect(q.sql).toContain("RETURNING id");
  });

  it("threads the schedule owner's user_id into both the claim and the inserted rows, and passes the snapshot as an object with a ::jsonb cast", async () => {
    const { enqueueInboxSql } = await import("../store.pg");
    const q = dialect.sqlToQuery(enqueueInboxSql(schedule, snapshot, "run-1"));
    // claim filter + inserted rows: two occurrences of the owner id.
    expect(q.params.filter((p) => p === "user-1")).toHaveLength(2);
    expect(q.sql).toMatch(/\$\d+::jsonb/);
    // NOT manually JSON.stringify'd — the driver serializes the object.
    expect(q.params).toContain(snapshot);
    expect(q.params).toEqual(["sched-1", "user-1", "user-1", snapshot, "sched-1", "run-1"]);
  });
});

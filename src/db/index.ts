import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { mkdirSync } from "fs";
import path from "path";
import { DATA_DIR } from "../lib/dataDir";
import { isHosted } from "../lib/profile";
import * as sqliteSchema from "./schema.sqlite";
import * as pgSchema from "./schema.pg";

// The shared type anchor: both dialects expose the same logical schema (see
// schema.ts), so every call site types against the sqlite database and the
// hosted (neon-http) instance is cast to it. Call sites must stick to the
// dialect-shared async surface — no `.all()/.get()/.run()`, no sync
// `db.transaction` (enforced by src/lib/__tests__/no-sync-drizzle.test.ts).
type Db = BetterSQLite3Database<typeof sqliteSchema>;

let sqliteInstance: Database.Database | null = null;
let dbInstance: Db | null = null;

function initLocal(): Db {
  mkdirSync(path.join(DATA_DIR, "files"), { recursive: true });

  const sqlite = new Database(path.join(DATA_DIR, "sift.db"));
  sqlite.pragma("journal_mode = WAL");
  // Concurrent module loads (e.g. Next's parallel page-data build workers)
  // race to run migrate() on a fresh DB; without a busy timeout the loser
  // fails instantly with SQLITE_BUSY instead of waiting its turn.
  sqlite.pragma("busy_timeout = 5000");

  const database = drizzle(sqlite, { schema: sqliteSchema });
  migrate(database, {
    migrationsFolder: process.env.SIFT_MIGRATIONS_DIR ?? path.join(process.cwd(), "drizzle"),
  });
  sqliteInstance = sqlite;
  return database;
}

function initHosted(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required on the hosted profile (SIFT_PROFILE=hosted)");
  }
  // No migrate-on-boot here: pg migrations are applied out-of-band
  // (`npm run db:push:pg`). Passing the pg schema keeps `db.query.*` working.
  return drizzleNeon(neon(url), { schema: pgSchema }) as unknown as Db;
}

function getDb(): Db {
  if (!dbInstance) {
    dbInstance = isHosted() ? initHosted() : initLocal();
  }
  return dbInstance;
}

// Local keeps its historical eager, import-time init (mkdir + pragmas +
// migrate). Hosted must stay lazy: importing this module without a
// DATABASE_URL (e.g. at build time) must not throw until `db` is first used.
if (!isHosted()) {
  getDb();
}

export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(real) : value;
  },
  has(_target, prop) {
    return prop in (getDb() as object);
  },
});

/** The raw better-sqlite3 handle — local profile only (hosted has no sqlite). */
export function getSqlite(): Database.Database {
  if (isHosted()) {
    throw new Error("getSqlite() is local-profile only — the hosted profile runs on Postgres (neon-http)");
  }
  getDb();
  return sqliteInstance!;
}

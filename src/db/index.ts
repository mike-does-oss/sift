import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "fs";
import path from "path";
import * as schema from "./schema";

const DATA_DIR = path.join(process.cwd(), "data");
mkdirSync(path.join(DATA_DIR, "files"), { recursive: true });

export const sqlite = new Database(path.join(DATA_DIR, "sift.db"));
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite, { schema });
migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });

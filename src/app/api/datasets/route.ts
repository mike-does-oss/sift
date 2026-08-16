import { NextRequest, NextResponse } from "next/server";
import { count, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { datasets, datasetRows } from "@/db/schema";
import { requireUser } from "@/lib/user";
import { rowsForHeaders } from "@/lib/datasets";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateHeaders(headers: unknown): headers is string[] {
  return (
    Array.isArray(headers) &&
    headers.length > 0 &&
    headers.every((h) => typeof h === "string" && h.length > 0) &&
    new Set(headers).size === headers.length
  );
}

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const rows = await db
    .select({
      id: datasets.id,
      name: datasets.name,
      headers: datasets.headers,
      createdAt: datasets.createdAt,
      rowCount: count(datasetRows.id),
    })
    .from(datasets)
    .leftJoin(datasetRows, eq(datasetRows.datasetId, datasets.id))
    .where(eq(datasets.userId, user.id))
    .groupBy(datasets.id)
    .orderBy(desc(datasets.createdAt));

  return NextResponse.json({ datasets: rows });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  let body: { name?: string; headers?: unknown; rows?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const { name, headers, rows } = body;

  if (!name || typeof name !== "string" || name.trim() === "") {
    return NextResponse.json({ error: "name is required and must be a non-empty string" }, { status: 400 });
  }
  if (!validateHeaders(headers)) {
    return NextResponse.json(
      { error: "headers is required and must be a non-empty array of unique, non-empty strings" },
      { status: 400 }
    );
  }
  if (rows !== undefined && (!Array.isArray(rows) || !rows.every(isPlainObject))) {
    return NextResponse.json({ error: "rows must be an array of objects" }, { status: 400 });
  }

  const initialRows = Array.isArray(rows) ? rowsForHeaders(rows as Record<string, unknown>[], headers) : [];

  // Transactionless (the hosted neon-http driver has no interactive
  // transactions): insert the dataset, then its rows; if the rows insert
  // fails, compensating-delete the dataset row so no empty shell survives,
  // then rethrow.
  const [inserted] = await db
    .insert(datasets)
    .values({ userId: user.id, name: name.trim(), headers })
    .returning();
  if (initialRows.length > 0) {
    try {
      await db
        .insert(datasetRows)
        .values(initialRows.map((row) => ({ userId: user.id, datasetId: inserted.id, row })));
    } catch (err) {
      await db.delete(datasets).where(eq(datasets.id, inserted.id));
      throw err;
    }
  }

  return NextResponse.json({ dataset: { ...inserted, rowCount: initialRows.length } });
}

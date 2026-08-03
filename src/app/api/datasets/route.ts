import { NextRequest, NextResponse } from "next/server";
import { count, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { datasets, datasetRows } from "@/db/schema";
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
    .groupBy(datasets.id)
    .orderBy(desc(datasets.createdAt));

  return NextResponse.json({ datasets: rows });
}

export async function POST(req: NextRequest) {
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

  const dataset = db.transaction((tx) => {
    const [inserted] = tx
      .insert(datasets)
      .values({ name: name.trim(), headers })
      .returning()
      .all();
    if (initialRows.length > 0) {
      tx
        .insert(datasetRows)
        .values(initialRows.map((row) => ({ datasetId: inserted.id, row })))
        .run();
    }
    return inserted;
  });

  return NextResponse.json({ dataset: { ...dataset, rowCount: initialRows.length } });
}

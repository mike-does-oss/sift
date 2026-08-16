import { NextRequest, NextResponse } from "next/server";
import { count, eq, and } from "drizzle-orm";
import { db } from "@/db";
import { datasets, datasetRows } from "@/db/schema";
import { rowsForHeaders } from "@/lib/datasets";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function find(id: string) {
  return db.query.datasets.findFirst({ where: eq(datasets.id, id) });
}

async function rowCount(id: string): Promise<number> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(datasetRows)
    .where(eq(datasetRows.datasetId, id));
  return n;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dataset = await find(id);
  if (!dataset) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: { rows?: unknown; sourceJobId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const { rows, sourceJobId } = body;

  if (!Array.isArray(rows) || rows.length === 0 || !rows.every(isPlainObject)) {
    return NextResponse.json({ error: "rows is required and must be a non-empty array of objects" }, { status: 400 });
  }
  if (sourceJobId !== undefined && typeof sourceJobId !== "string") {
    return NextResponse.json({ error: "sourceJobId must be a string" }, { status: 400 });
  }

  const projected = rowsForHeaders(rows as Record<string, unknown>[], dataset.headers as string[]);

  // Single statement — needs no transaction on either dialect.
  await db
    .insert(datasetRows)
    .values(projected.map((row) => ({ datasetId: id, row, sourceJobId: sourceJobId ?? null })));

  return NextResponse.json({ added: projected.length, rowCount: await rowCount(id) });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dataset = await find(id);
  if (!dataset) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const rowId = req.nextUrl.searchParams.get("rowId");
  if (!rowId) {
    return NextResponse.json({ error: "rowId query param is required" }, { status: 400 });
  }

  const row = await db.query.datasetRows.findFirst({
    where: and(eq(datasetRows.id, rowId), eq(datasetRows.datasetId, id)),
  });
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db.delete(datasetRows).where(eq(datasetRows.id, rowId));

  return NextResponse.json({ ok: true, rowCount: await rowCount(id) });
}

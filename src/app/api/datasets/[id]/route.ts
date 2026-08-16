import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { datasets, datasetRows } from "@/db/schema";

async function find(id: string) {
  return db.query.datasets.findFirst({ where: eq(datasets.id, id) });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dataset = await find(id);
  if (!dataset) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const rows = await db.query.datasetRows.findMany({
    where: eq(datasetRows.datasetId, id),
    orderBy: asc(datasetRows.addedAt),
  });

  return NextResponse.json({
    dataset: { ...dataset, rowCount: rows.length },
    rows: rows.map((r) => ({ id: r.id, row: r.row, addedAt: r.addedAt })),
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await find(id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Non-atomic (no cross-dialect transactions): rows first, then the dataset.
  // Worst case a failure in between leaves orphan rows for a dataset that
  // survives — the user retries the delete.
  await db.delete(datasetRows).where(eq(datasetRows.datasetId, id));
  await db.delete(datasets).where(eq(datasets.id, id));

  return NextResponse.json({ ok: true });
}

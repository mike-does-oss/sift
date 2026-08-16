import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { datasets, datasetRows } from "@/db/schema";
import { requireUser } from "@/lib/user";

// Cross-tenant dataset ids 404 (existence not revealed). Child rows are read
// by datasetId only AFTER parent ownership is verified.
async function find(id: string, userId: string) {
  return db.query.datasets.findFirst({ where: and(eq(datasets.id, id), eq(datasets.userId, userId)) });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { id } = await params;
  const dataset = await find(id, user.id);
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
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { id } = await params;
  if (!(await find(id, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Non-atomic (no cross-dialect transactions): rows first, then the dataset.
  // Worst case a failure in between leaves orphan rows for a dataset that
  // survives — the user retries the delete.
  await db.delete(datasetRows).where(eq(datasetRows.datasetId, id));
  await db.delete(datasets).where(eq(datasets.id, id));

  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { datasets, datasetRows } from "@/db/schema";
import { rowsForHeaders } from "@/lib/datasets";
import { toCsv } from "@/lib/export";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dataset = await db.query.datasets.findFirst({ where: eq(datasets.id, id) });
  if (!dataset) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const rows = await db.query.datasetRows.findMany({
    where: eq(datasetRows.datasetId, id),
    orderBy: asc(datasetRows.addedAt),
  });

  const headers = dataset.headers as string[];
  const projected = rowsForHeaders(
    rows.map((r) => r.row as Record<string, unknown>),
    headers
  );
  const csv = projected.length > 0 ? toCsv(projected) : headers.join(",");

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${dataset.name}.csv"`,
    },
  });
}

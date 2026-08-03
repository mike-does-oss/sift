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

  // Strip path separators, quotes, and control characters so the dataset
  // name can't break out of the quoted filename or smuggle a path.
  const safeName = dataset.name.replace(/[/\\"]/g, "_").replace(/[\x00-\x1f]/g, "").trim() || "dataset";

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${safeName}.csv"`,
    },
  });
}

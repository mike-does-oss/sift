import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { datasets, datasetRows } from "@/db/schema";
import { requireUser } from "@/lib/user";
import { rowsForHeaders } from "@/lib/datasets";
import { toCsv } from "@/lib/export";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { id } = await params;
  // Cross-tenant dataset ids 404; rows are read by datasetId only after
  // parent ownership is verified.
  const dataset = await db.query.datasets.findFirst({
    where: and(eq(datasets.id, id), eq(datasets.userId, user.id)),
  });
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

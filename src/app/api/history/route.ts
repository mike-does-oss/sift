import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { jobs, documents } from "@/db/schema";

export async function GET(req: NextRequest) {
  const limit = Math.min(200, Number(req.nextUrl.searchParams.get("limit") ?? 50));
  const rows = await db
    .select({ job: jobs, filename: documents.filename })
    .from(jobs)
    .leftJoin(documents, eq(jobs.documentId, documents.id))
    .orderBy(desc(jobs.createdAt))
    .limit(limit);
  return NextResponse.json({ jobs: rows });
}

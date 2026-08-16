import { NextRequest, NextResponse } from "next/server";
import { and, eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { jobs, documents } from "@/db/schema";
import { requireUser } from "@/lib/user";

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const parsed = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Math.min(200, Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 50);
  const rows = await db
    .select({ job: jobs, filename: documents.filename })
    .from(jobs)
    .leftJoin(documents, and(eq(jobs.documentId, documents.id), eq(documents.userId, user.id)))
    .where(eq(jobs.userId, user.id))
    .orderBy(desc(jobs.createdAt))
    .limit(limit);
  return NextResponse.json({ jobs: rows });
}

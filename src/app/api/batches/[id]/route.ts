import { NextRequest, NextResponse } from "next/server";
import { and, eq, asc } from "drizzle-orm";
import { db } from "@/db";
import { batches, jobs, documents } from "@/db/schema";
import { requireUser } from "@/lib/user";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { id } = await params;
  // Cross-tenant batch ids 404 (existence not revealed).
  const batch = await db.query.batches.findFirst({
    where: and(eq(batches.id, id), eq(batches.userId, user.id)),
  });
  if (!batch) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Both sides of the join are tenant-scoped: jobs by userId, and the joined
  // documents row must belong to the same user as the job.
  const jobRows = await db
    .select({ job: jobs, filename: documents.filename })
    .from(jobs)
    .leftJoin(documents, and(eq(jobs.documentId, documents.id), eq(documents.userId, user.id)))
    .where(and(eq(jobs.batchId, id), eq(jobs.userId, user.id)))
    .orderBy(asc(jobs.createdAt));
  return NextResponse.json({ batch, jobs: jobRows });
}

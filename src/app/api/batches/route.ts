import { NextRequest, NextResponse } from "next/server";
import { inArray, desc } from "drizzle-orm";
import { db } from "@/db";
import { batches, documents, jobs } from "@/db/schema";
import { processPendingJobs } from "@/lib/jobs";

export async function POST(req: NextRequest) {
  let body: { name?: string; documentIds?: string[]; template?: { fields?: unknown[] } };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const { name, documentIds, template } = body;

  if (!name || typeof name !== "string" || name.trim() === "") {
    return NextResponse.json({ error: "name is required and must be a non-empty string" }, { status: 400 });
  }
  if (!Array.isArray(documentIds) || documentIds.length === 0) {
    return NextResponse.json({ error: "documentIds required" }, { status: 400 });
  }
  if (!template?.fields?.length) {
    return NextResponse.json({ error: "template.fields required" }, { status: 400 });
  }

  const docs = await db.query.documents.findMany({ where: inArray(documents.id, documentIds) });
  if (docs.length !== documentIds.length) {
    return NextResponse.json({ error: "Some documents were not found" }, { status: 400 });
  }

  const [batch] = await db.insert(batches).values({
    name: name.trim(),
    templateSnapshot: template,
    totalCount: docs.length,
  }).returning();

  await db.insert(jobs).values(docs.map((d) => ({
    documentId: d.id,
    templateSnapshot: template,
    source: "batch" as const,
    batchId: batch.id,
  })));

  void processPendingJobs(240_000);

  return NextResponse.json({ batchId: batch.id });
}

export async function GET() {
  const list = await db.query.batches.findMany({ orderBy: desc(batches.createdAt) });
  return NextResponse.json({ batches: list });
}

import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { schedules, jobs, documents } from "@/db/schema";
import { parseOutputDirInput, parseOutputFormatInput, parseKeepResultsInput } from "@/lib/output-writer";

async function find(id: string) {
  return db.query.schedules.findFirst({ where: eq(schedules.id, id) });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const schedule = await find(id);
  if (!schedule) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const runs = await db
    .select({ job: jobs, filename: documents.filename })
    .from(jobs)
    .leftJoin(documents, eq(jobs.documentId, documents.id))
    .where(eq(jobs.scheduleId, id))
    .orderBy(desc(jobs.createdAt));
  return NextResponse.json({ schedule, jobs: runs });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await find(id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: {
    active?: boolean;
    name?: string;
    outputDir?: unknown;
    outputFormat?: unknown;
    keepResults?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const { active, name } = body;

  // §output-dest: partial update — only touch a field when the request
  // actually included its key, so e.g. PATCHing just `{ active }` (the
  // existing toggle flow) never resets the output settings.
  const patch: Partial<typeof schedules.$inferInsert> = {
    ...(typeof active === "boolean" ? { active } : {}),
    ...(name ? { name } : {}),
  };
  if ("outputDir" in body) {
    const result = parseOutputDirInput(body.outputDir);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    patch.outputDir = result.value;
  }
  if ("outputFormat" in body) {
    const result = parseOutputFormatInput(body.outputFormat);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    patch.outputFormat = result.value;
  }
  if ("keepResults" in body) {
    const result = parseKeepResultsInput(body.keepResults);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    patch.keepResults = result.value;
  }

  const [updated] = await db.update(schedules).set(patch).where(eq(schedules.id, id)).returning();
  return NextResponse.json({ schedule: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await find(id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.delete(schedules).where(eq(schedules.id, id));
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { schedules, jobs, documents } from "@/db/schema";

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

  let body: { active?: boolean; name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const { active, name } = body;
  const [updated] = await db.update(schedules)
    .set({ ...(typeof active === "boolean" ? { active } : {}), ...(name ? { name } : {}) })
    .where(eq(schedules.id, id)).returning();
  return NextResponse.json({ schedule: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await find(id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.delete(schedules).where(eq(schedules.id, id));
  return NextResponse.json({ ok: true });
}

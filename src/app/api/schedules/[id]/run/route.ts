import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { schedules } from "@/db/schema";
import { enqueueScheduleNow, processPendingJobs } from "@/lib/jobs";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const schedule = await db.query.schedules.findFirst({ where: eq(schedules.id, id) });
  if (!schedule) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const jobsCreated = await enqueueScheduleNow(id);
  void processPendingJobs(240_000);

  return NextResponse.json({ jobsCreated });
}

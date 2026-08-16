import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { schedules } from "@/db/schema";
import { requireUser } from "@/lib/user";
import { enqueueScheduleNow, processPendingJobs } from "@/lib/jobs";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { id } = await params;
  // Cross-tenant schedule ids 404; ownership is verified here, so the
  // worker-side enqueue can trust the schedule row's own userId.
  const schedule = await db.query.schedules.findFirst({
    where: and(eq(schedules.id, id), eq(schedules.userId, user.id)),
  });
  if (!schedule) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const jobsCreated = await enqueueScheduleNow(id);
  void processPendingJobs(240_000);

  return NextResponse.json({ jobsCreated });
}

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { schedules } from "@/db/schema";
import { requireUser } from "@/lib/user";
import { scheduleGate } from "@/lib/gates";
import { enqueueScheduleNow, kickJobWorker } from "@/lib/jobs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  // §SaaS-1 T5: manual runs are gated like the cron's downgrade-skip — a
  // downgraded owner must not be able to trigger runs by hand either.
  const denial = scheduleGate(user.plan);
  if (denial) {
    return NextResponse.json({ error: denial.error, code: denial.code }, { status: denial.status });
  }

  const { id } = await params;
  // Cross-tenant schedule ids 404; ownership is verified here, so the
  // worker-side enqueue can trust the schedule row's own userId.
  const schedule = await db.query.schedules.findFirst({
    where: and(eq(schedules.id, id), eq(schedules.userId, user.id)),
  });
  if (!schedule) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const jobsCreated = await enqueueScheduleNow(id);
  // Local: in-process fire-and-forget; hosted: authorized fetch to the
  // worker route (a bare void promise dies with the serverless invocation).
  kickJobWorker(req.nextUrl.origin);

  return NextResponse.json({ jobsCreated });
}

import { NextRequest, NextResponse } from "next/server";
import { isHosted } from "@/lib/profile";

// Hosted schedule ticker (§SaaS-1 T3, donor: extracto-app). Vercel Cron hits
// GET every minute; due-ness is computed from each schedule's own cadence
// fields against `lastRunAt` (src/lib/schedule.ts), so the tick frequency is
// just a polling rate. Runs across ALL users' active schedules — enqueueing
// is scoped per schedule row's userId inside the store.
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get("authorization") === `Bearer ${secret}`;
}

async function handle(req: NextRequest) {
  // Local runs schedules on the in-process instrumentation tick.
  if (!isHosted()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { runDueSchedules, kickJobWorker } = await import("@/lib/jobs");
  let schedulesChecked: number;
  let jobsCreated: number;
  try {
    ({ schedulesChecked, jobsCreated } = await runDueSchedules());
  } catch (err) {
    console.error("Schedule run failed:", err);
    return NextResponse.json({ error: "schedule run failed" }, { status: 500 });
  }
  if (jobsCreated > 0) {
    kickJobWorker(req.nextUrl.origin);
  }
  return NextResponse.json({ schedulesChecked, jobsCreated });
}

export const GET = handle; // Vercel Cron uses GET
export const POST = handle;

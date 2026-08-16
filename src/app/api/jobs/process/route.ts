import { NextRequest, NextResponse } from "next/server";
import { isHosted } from "@/lib/profile";

// Hosted worker entrypoint (§SaaS-1 T3, donor: extracto-app). Vercel Cron
// hits GET every minute (vercel.json) with the project's CRON_SECRET as the
// bearer; the route drains work within its budget and self-chains via POST
// while any remains, so a burst clears faster than one tick per minute.
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get("authorization") === `Bearer ${secret}`;
}

async function handle(req: NextRequest) {
  // Local runs the worker in-process (instrumentation tick) — this route
  // exists only on the hosted profile.
  if (!isHosted()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Lazy import: keep the jobs machinery (db client and all) out of the
  // module graph until an authorized hosted request actually needs it.
  const { processPendingJobs, kickJobWorker } = await import("@/lib/jobs");
  let processed: number;
  let remaining: number;
  try {
    ({ processed, remaining } = await processPendingJobs(240_000));
  } catch (err) {
    console.error("Job worker failed:", err);
    return NextResponse.json({ error: "worker failed" }, { status: 500 });
  }
  if (remaining > 0) {
    // Fire-and-forget continuation (kickJobWorker POSTs this same route with
    // the bearer header and anchors the fetch via waitUntil).
    kickJobWorker(req.nextUrl.origin);
  }
  return NextResponse.json({ processed, remaining });
}

export const GET = handle; // Vercel Cron uses GET
export const POST = handle; // self-chain + in-app kicks

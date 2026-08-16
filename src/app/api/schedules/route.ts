import { NextRequest, NextResponse } from "next/server";
import { and, eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { schedules, templates } from "@/db/schema";
import { requireUser } from "@/lib/user";
import { scheduleGate } from "@/lib/gates";
import { parseOutputDirInput, parseOutputFormatInput, parseKeepResultsInput } from "@/lib/output-writer";

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  // §SaaS-1 T5: schedules are a plan feature (no-op for the "local" plan).
  const denial = scheduleGate(user.plan);
  if (denial) {
    return NextResponse.json({ error: denial.error, code: denial.code }, { status: denial.status });
  }

  let body: {
    name?: string;
    templateId?: string;
    cadence?: string;
    hourUtc?: number;
    dayOfWeek?: number;
    outputDir?: unknown;
    outputFormat?: unknown;
    keepResults?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const { name, templateId, cadence, hourUtc, dayOfWeek } = body;

  if (!name || !templateId || !["daily", "weekly"].includes(cadence ?? "")) {
    return NextResponse.json({ error: "name, templateId, cadence required" }, { status: 400 });
  }
  if (typeof hourUtc !== "number" || hourUtc < 0 || hourUtc > 23) {
    return NextResponse.json({ error: "hourUtc must be 0-23" }, { status: 400 });
  }
  if (cadence === "weekly" && (typeof dayOfWeek !== "number" || dayOfWeek < 0 || dayOfWeek > 6)) {
    return NextResponse.json({ error: "dayOfWeek 0-6 required for weekly" }, { status: 400 });
  }
  // Scoped: a schedule can only ever point at its owner's template.
  const template = await db.query.templates.findFirst({
    where: and(eq(templates.id, templateId), eq(templates.userId, user.id)),
  });
  if (!template) return NextResponse.json({ error: "Template not found" }, { status: 400 });

  // §output-dest: same output-folder validation the batches route uses.
  const outputDirResult = parseOutputDirInput(body.outputDir);
  if ("error" in outputDirResult) {
    return NextResponse.json({ error: outputDirResult.error }, { status: 400 });
  }
  const outputFormatResult = parseOutputFormatInput(body.outputFormat);
  if ("error" in outputFormatResult) {
    return NextResponse.json({ error: outputFormatResult.error }, { status: 400 });
  }
  const keepResultsResult = parseKeepResultsInput(body.keepResults);
  if ("error" in keepResultsResult) {
    return NextResponse.json({ error: keepResultsResult.error }, { status: 400 });
  }

  const [schedule] = await db.insert(schedules).values({
    userId: user.id,
    name, templateId, cadence: cadence as "daily" | "weekly", hourUtc,
    dayOfWeek: cadence === "weekly" ? (dayOfWeek ?? null) : null,
    outputDir: outputDirResult.value,
    outputFormat: outputFormatResult.value,
    keepResults: keepResultsResult.value,
  }).returning();
  return NextResponse.json({ schedule });
}

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const list = await db.query.schedules.findMany({
    where: eq(schedules.userId, user.id),
    orderBy: desc(schedules.createdAt),
  });
  return NextResponse.json({ schedules: list });
}

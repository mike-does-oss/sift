import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { schedules, templates } from "@/db/schema";

export async function POST(req: NextRequest) {
  let body: { name?: string; templateId?: string; cadence?: string; hourUtc?: number; dayOfWeek?: number };
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
  const template = await db.query.templates.findFirst({ where: eq(templates.id, templateId) });
  if (!template) return NextResponse.json({ error: "Template not found" }, { status: 400 });

  const [schedule] = await db.insert(schedules).values({
    name, templateId, cadence: cadence as "daily" | "weekly", hourUtc,
    dayOfWeek: cadence === "weekly" ? (dayOfWeek ?? null) : null,
  }).returning();
  return NextResponse.json({ schedule });
}

export async function GET() {
  const list = await db.query.schedules.findMany({ orderBy: desc(schedules.createdAt) });
  return NextResponse.json({ schedules: list });
}

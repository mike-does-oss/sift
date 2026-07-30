import { NextRequest, NextResponse } from "next/server";
import { eq, isNull, desc } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";

export async function GET(req: NextRequest) {
  const scheduleId = req.nextUrl.searchParams.get("scheduleId");
  const where = scheduleId ? eq(documents.scheduleId, scheduleId) : isNull(documents.scheduleId);
  const docs = await db.query.documents.findMany({ where, orderBy: desc(documents.createdAt) });
  return NextResponse.json({ documents: docs });
}

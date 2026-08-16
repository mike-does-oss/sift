import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull, desc } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { requireUser } from "@/lib/user";

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const scheduleId = req.nextUrl.searchParams.get("scheduleId");
  // Tenancy first, then the inbox filter — a `?scheduleId=` belonging to
  // another user matches nothing (the documents themselves are user-scoped).
  const where = and(
    eq(documents.userId, user.id),
    scheduleId ? eq(documents.scheduleId, scheduleId) : isNull(documents.scheduleId)
  );
  const docs = await db.query.documents.findMany({ where, orderBy: desc(documents.createdAt) });
  return NextResponse.json({ documents: docs });
}

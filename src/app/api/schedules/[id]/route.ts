import { NextRequest, NextResponse } from "next/server";
import { and, eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { schedules, jobs, documents, templates } from "@/db/schema";
import { requireUser } from "@/lib/user";
import { scheduleGate } from "@/lib/gates";
import { isHosted } from "@/lib/profile";
import { configuredInboundDomain } from "@/lib/resend";
import { parseDeliverySettingsInput } from "@/lib/delivery-settings";
import { parseOutputDirInput, parseOutputFormatInput, parseKeepResultsInput } from "@/lib/output-writer";

// Cross-tenant schedule ids 404 (existence not revealed).
async function find(id: string, userId: string) {
  return db.query.schedules.findFirst({ where: and(eq(schedules.id, id), eq(schedules.userId, userId)) });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { id } = await params;
  const schedule = await find(id, user.id);
  if (!schedule) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // What this schedule extracts — the detail header names the template
  // (scoped like everything else; null if the template was since deleted).
  const template = await db.query.templates.findFirst({
    where: and(eq(templates.id, schedule.templateId), eq(templates.userId, user.id)),
    columns: { name: true },
  });
  const runs = await db
    .select({ job: jobs, filename: documents.filename })
    .from(jobs)
    .leftJoin(documents, and(eq(jobs.documentId, documents.id), eq(documents.userId, user.id)))
    .where(and(eq(jobs.scheduleId, id), eq(jobs.userId, user.id)))
    .orderBy(desc(jobs.createdAt));
  return NextResponse.json({
    schedule,
    templateName: template?.name ?? null,
    jobs: runs,
    // §INBOX T3: same contract as the list GET — the email-in domain for
    // rendering the schedule's address; null when local or unconfigured.
    inboundDomain: isHosted() ? configuredInboundDomain() : null,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  // §SaaS-1 T5: create/update are plan-gated (no-op for "local"); a
  // downgraded owner can still GET and DELETE their now-dormant schedules.
  const denial = scheduleGate(user.plan);
  if (denial) {
    return NextResponse.json({ error: denial.error, code: denial.code }, { status: denial.status });
  }

  const { id } = await params;
  if (!(await find(id, user.id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: {
    active?: boolean;
    name?: string;
    outputDir?: unknown;
    outputFormat?: unknown;
    keepResults?: unknown;
    ingestMode?: unknown;
    processOnArrival?: unknown;
    allowedSenders?: unknown;
    datasetId?: unknown;
    notifyEmail?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const { active, name } = body;

  // §output-dest: partial update — only touch a field when the request
  // actually included its key, so e.g. PATCHing just `{ active }` (the
  // existing toggle flow) never resets the output settings.
  const patch: Partial<typeof schedules.$inferInsert> = {
    ...(typeof active === "boolean" ? { active } : {}),
    ...(name ? { name } : {}),
  };
  if ("outputDir" in body) {
    const result = parseOutputDirInput(body.outputDir);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    patch.outputDir = result.value;
  }
  if ("outputFormat" in body) {
    const result = parseOutputFormatInput(body.outputFormat);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    patch.outputFormat = result.value;
  }
  if ("keepResults" in body) {
    const result = parseKeepResultsInput(body.keepResults);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    patch.keepResults = result.value;
  }

  // §INBOX T3: email-in delivery settings — same partial-update contract
  // (only keys present in the request are touched); datasetId is
  // ownership-checked inside (cross-tenant ids get "Dataset not found").
  const deliveryResult = await parseDeliverySettingsInput(body, user.id);
  if ("error" in deliveryResult) {
    return NextResponse.json({ error: deliveryResult.error }, { status: 400 });
  }
  Object.assign(patch, deliveryResult.value);

  const [updated] = await db.update(schedules).set(patch)
    .where(and(eq(schedules.id, id), eq(schedules.userId, user.id)))
    .returning();
  return NextResponse.json({ schedule: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { id } = await params;
  if (!(await find(id, user.id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.delete(schedules).where(and(eq(schedules.id, id), eq(schedules.userId, user.id)));
  return NextResponse.json({ ok: true });
}

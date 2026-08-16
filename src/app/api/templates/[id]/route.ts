import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { templates, schedules } from "@/db/schema";
import { requireUser } from "@/lib/user";
import { validateExamples } from "@/lib/template-examples";

// Cross-tenant access convention: a template that exists but belongs to
// another user is indistinguishable from one that doesn't exist — 404.
async function find(id: string, userId: string) {
  return db.query.templates.findFirst({ where: and(eq(templates.id, id), eq(templates.userId, userId)) });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { id } = await params;
  if (!(await find(id, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: { name?: string; fields?: unknown[]; prompt?: string; extractMultiple?: boolean; examples?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const { name, fields, prompt, extractMultiple, examples: rawExamples } = body;
  const updates: Partial<typeof templates.$inferInsert> = {};

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim() === "") {
      return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400 });
    }
    updates.name = name.trim();
  }

  if (fields !== undefined) {
    if (!Array.isArray(fields) || fields.length === 0) {
      return NextResponse.json({ error: "fields must be a non-empty array" }, { status: 400 });
    }
    updates.fields = fields;
  }

  if (prompt !== undefined) {
    if (typeof prompt !== "string") {
      return NextResponse.json({ error: "prompt must be a string" }, { status: 400 });
    }
    updates.prompt = prompt;
  }

  if (extractMultiple !== undefined) {
    if (typeof extractMultiple !== "boolean") {
      return NextResponse.json({ error: "extractMultiple must be a boolean" }, { status: 400 });
    }
    updates.extractMultiple = extractMultiple;
  }

  if (rawExamples !== undefined) {
    const examplesResult = validateExamples(rawExamples);
    if (!examplesResult.ok) {
      return NextResponse.json({ error: examplesResult.error }, { status: 400 });
    }
    updates.examples = examplesResult.examples;
  }

  updates.updatedAt = new Date();

  const [updated] = await db.update(templates)
    .set(updates)
    .where(and(eq(templates.id, id), eq(templates.userId, user.id)))
    .returning();

  return NextResponse.json({ template: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { id } = await params;
  if (!(await find(id, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Templates are per-user, so only this user's schedules can reference this
  // template — but scope anyway so a (buggy) cross-tenant reference could
  // never leak another tenant's schedule name.
  const usedBy = await db.query.schedules.findFirst({
    where: and(eq(schedules.templateId, id), eq(schedules.userId, user.id)),
  });
  if (usedBy) {
    return NextResponse.json(
      { error: `This template is used by schedule "${usedBy.name}" — delete or repoint that schedule first.` },
      { status: 409 }
    );
  }

  await db.delete(templates).where(and(eq(templates.id, id), eq(templates.userId, user.id)));
  return NextResponse.json({ ok: true });
}

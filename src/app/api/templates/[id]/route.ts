import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { templates } from "@/db/schema";

async function find(id: string) {
  return db.query.templates.findFirst({ where: eq(templates.id, id) });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await find(id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: { name?: string; fields?: unknown[]; prompt?: string; extractMultiple?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const { name, fields, prompt, extractMultiple } = body;
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

  updates.updatedAt = new Date();

  const [updated] = await db.update(templates)
    .set(updates)
    .where(eq(templates.id, id))
    .returning();

  return NextResponse.json({ template: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await find(id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db.delete(templates).where(eq(templates.id, id));
  return NextResponse.json({ ok: true });
}

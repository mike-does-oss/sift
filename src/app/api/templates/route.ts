import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { templates } from "@/db/schema";
import { requireUser } from "@/lib/user";
import { validateExamples } from "@/lib/template-examples";

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  let body: { name?: string; fields?: unknown[]; prompt?: string; extractMultiple?: boolean; examples?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const { name, fields, prompt = "", extractMultiple = false, examples: rawExamples } = body;

  if (!name || typeof name !== "string" || name.trim() === "") {
    return NextResponse.json({ error: "name is required and must be a non-empty string" }, { status: 400 });
  }
  if (!Array.isArray(fields) || fields.length === 0) {
    return NextResponse.json({ error: "fields is required and must be a non-empty array" }, { status: 400 });
  }
  const examplesResult = validateExamples(rawExamples);
  if (!examplesResult.ok) {
    return NextResponse.json({ error: examplesResult.error }, { status: 400 });
  }

  const [template] = await db.insert(templates).values({
    userId: user.id,
    name: name.trim(),
    fields,
    prompt: typeof prompt === "string" ? prompt : "",
    extractMultiple: typeof extractMultiple === "boolean" ? extractMultiple : false,
    examples: examplesResult.examples,
  }).returning();

  return NextResponse.json({ template });
}

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const list = await db.query.templates.findMany({
    where: eq(templates.userId, user.id),
    orderBy: desc(templates.createdAt),
  });
  return NextResponse.json({ templates: list });
}

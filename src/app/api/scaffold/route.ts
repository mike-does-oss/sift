import { NextRequest, NextResponse } from "next/server";
import { scaffoldSchema, validateScaffoldDescription } from "@/lib/extraction/scaffold";

export async function POST(req: NextRequest) {
  let body: { description?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const validated = validateScaffoldDescription(body?.description);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const result = await scaffoldSchema(validated.description);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ fields: result.fields, prompt: result.prompt, extractMultiple: result.extractMultiple });
}

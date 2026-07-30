import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { runExtraction } from "@/lib/extraction";
import type { ExtractionField } from "@/types";

export async function POST(request: NextRequest) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ success: false, error: "Expected multipart form data with a \"file\" field." }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  const fieldsJson = formData.get("fields") as string | null;
  const prompt = (formData.get("prompt") as string) ?? "";
  const extractMultiple = formData.get("extractMultiple") === "true";

  if (!file) return NextResponse.json({ success: false, error: "No file provided" }, { status: 400 });
  if (!fieldsJson) return NextResponse.json({ success: false, error: "No fields configuration provided" }, { status: 400 });

  let fields: ExtractionField[];
  try {
    fields = JSON.parse(fieldsJson);
  } catch {
    return NextResponse.json({ success: false, error: "fields must be valid JSON" }, { status: 400 });
  }
  if (!Array.isArray(fields) || !fields.length || fields.some((f) => !f.name?.trim())) {
    return NextResponse.json({ success: false, error: "All fields must have a name" }, { status: 400 });
  }

  const pdfBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  const result = await runExtraction({ pdfBase64, filename: file.name, fields, prompt, extractMultiple });

  await db.insert(jobs).values({
    templateSnapshot: { fields, prompt, extractMultiple },
    status: result.success ? "completed" : "failed",
    attempts: 1,
    result: result.success ? result.data : null,
    error: result.success ? null : result.error,
    source: "single",
    provider: result.provider,
    model: result.model,
    startedAt: new Date(),
    completedAt: new Date(),
  });

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error, provider: result.provider, model: result.model }, { status: 500 });
  }
  return NextResponse.json({ success: true, data: result.data, provider: result.provider, model: result.model });
}

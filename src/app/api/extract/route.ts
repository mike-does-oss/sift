import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { requireUser } from "@/lib/user";
import { runExtraction, type ExtractionOverride } from "@/lib/extraction";
import { byoKeyActive, quotaGate } from "@/lib/gates";
import { getMonthlyUsage } from "@/lib/usage";
import { isProviderId } from "@/lib/api";
import { parseDocument, detectExtension, IMAGE_EXTENSIONS } from "@/lib/documents";
import { validateExamples } from "@/lib/template-examples";
import type { ExtractionField } from "@/types";

// Mirrors /api/upload's caps (src/app/api/upload/route.ts) — applied here too
// because /api/extract parses the file itself (mailparser/unpdf) rather than
// just storing bytes, so an unbounded upload is a parsing-cost concern on
// this path as well.
const MAX_DOC_SIZE_BYTES = 32 * 1024 * 1024;
const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

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
  const grounded = formData.get("grounded") === "true";
  const examplesJson = formData.get("examples") as string | null;

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

  let rawExamples: unknown;
  if (examplesJson) {
    try {
      rawExamples = JSON.parse(examplesJson);
    } catch {
      return NextResponse.json({ success: false, error: "examples must be valid JSON" }, { status: 400 });
    }
  }
  const examplesResult = validateExamples(rawExamples);
  if (!examplesResult.ok) {
    return NextResponse.json({ success: false, error: examplesResult.error }, { status: 400 });
  }
  const examples = examplesResult.examples;

  const providerField = formData.get("provider") as string | null;
  const modelField = formData.get("model") as string | null;
  let override: ExtractionOverride | undefined;
  if (providerField) {
    if (!isProviderId(providerField)) {
      return NextResponse.json({ success: false, error: `Unknown provider "${providerField}"` }, { status: 400 });
    }
    override = { provider: providerField, model: modelField || undefined };
  }

  // §SaaS-1 T5 hosted gates — the synthetic "local" plan bypasses them all
  // (byoActive is false and quotaGate returns null for it, and getMonthlyUsage
  // short-circuits to 0 off-hosted). On hosted, the provider/model pair is a
  // billing decision made inside resolveProvider's hosted branch (plan
  // tiering, BYO → opus), so any user-supplied override is discarded; a BYO
  // key skips the quota check entirely (quota-exempt, stamped on the job row).
  const byoActive = byoKeyActive(user);
  if (user.plan !== "local") {
    override = undefined;
    if (!byoActive) {
      const denial = quotaGate(user.plan, await getMonthlyUsage(user.id), 1);
      if (denial) {
        return NextResponse.json({ success: false, error: denial.error, code: denial.code }, { status: denial.status });
      }
    }
  }

  const buf = Buffer.from(await file.arrayBuffer());

  let ext: string;
  try {
    ext = detectExtension(buf, file.name);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't read this file.";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
  const isImage = IMAGE_EXTENSIONS.has(ext);
  const maxSize = isImage ? MAX_IMAGE_SIZE_BYTES : MAX_DOC_SIZE_BYTES;
  if (buf.length > maxSize) {
    const limit = isImage ? "8MB" : "32MB";
    return NextResponse.json({ success: false, error: `File must be ${limit} or smaller.` }, { status: 400 });
  }

  let source: Awaited<ReturnType<typeof parseDocument>>;
  try {
    source = await parseDocument(buf, file.name);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't read this file.";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }

  let result: Awaited<ReturnType<typeof runExtraction>>;
  try {
    result = await runExtraction({ source, filename: file.name, fields, prompt, extractMultiple, grounded, examples }, override, user.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Extraction failed unexpectedly";
    await db.insert(jobs).values({
      userId: user.id,
      // Single runs have no documents row — the uploaded file's name is the
      // job's identity in history/overview (see jobs.sourceFilename).
      sourceFilename: file.name,
      // `grounded` rides in the snapshot so history's fallback summary can
      // say "3 fields · grounded" for runs with no filename at all.
      templateSnapshot: { fields, prompt, extractMultiple, examples, grounded },
      status: "failed",
      attempts: 1,
      result: null,
      error: message,
      source: "single",
      provider: null,
      model: null,
      usedByoKey: byoActive,
      startedAt: new Date(),
      completedAt: new Date(),
    });
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }

  await db.insert(jobs).values({
    userId: user.id,
    sourceFilename: file.name,
    templateSnapshot: { fields, prompt, extractMultiple, examples, grounded },
    status: result.success ? "completed" : "failed",
    attempts: 1,
    result: result.success ? result.data : null,
    error: result.success ? null : result.error,
    source: "single",
    provider: result.provider,
    model: result.model,
    usedByoKey: byoActive,
    startedAt: new Date(),
    completedAt: new Date(),
  });

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error, provider: result.provider, model: result.model }, { status: 500 });
  }
  // `text` is the document text the model saw — absent for images (vision
  // only, no text representation). For PDFs this is the extracted text layer
  // (used to anchor result values in the source even when the engine itself
  // read the PDF natively via vision). Additive: existing clients ignore it.
  const text = source.kind === "image" ? undefined : source.text;
  return NextResponse.json({
    success: true,
    data: result.data,
    provider: result.provider,
    model: result.model,
    text,
    ...(result.quotes !== undefined ? { quotes: result.quotes } : {}),
  });
}

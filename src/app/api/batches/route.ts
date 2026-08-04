import { NextRequest, NextResponse } from "next/server";
import { inArray, desc } from "drizzle-orm";
import { db } from "@/db";
import { batches, documents, jobs } from "@/db/schema";
import { processPendingJobs } from "@/lib/jobs";
import { validateExamples } from "@/lib/template-examples";
import { parseOutputDirInput, parseOutputFormatInput, parseKeepResultsInput } from "@/lib/output-writer";

export async function POST(req: NextRequest) {
  let body: {
    name?: string;
    documentIds?: string[];
    template?: { fields?: unknown[]; examples?: unknown };
    outputDir?: unknown;
    outputFormat?: unknown;
    keepResults?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const { name, documentIds, template } = body;

  if (!name || typeof name !== "string" || name.trim() === "") {
    return NextResponse.json({ error: "name is required and must be a non-empty string" }, { status: 400 });
  }
  if (!Array.isArray(documentIds) || documentIds.length === 0) {
    return NextResponse.json({ error: "documentIds required" }, { status: 400 });
  }
  if (!template?.fields?.length) {
    return NextResponse.json({ error: "template.fields required" }, { status: 400 });
  }
  // §T3: examples ride inside the client-supplied template snapshot — same
  // validation as the templates API, so a batch can't smuggle in a malformed
  // examples array that would only surface as an engine-level failure later.
  const examplesResult = validateExamples(template.examples);
  if (!examplesResult.ok) {
    return NextResponse.json({ error: examplesResult.error }, { status: 400 });
  }
  const templateSnapshot = { ...template, examples: examplesResult.examples };

  // §output-dest: output-folder settings — absent/empty outputDir is fine
  // (no auto-write), anything else must resolve to an absolute path.
  const outputDirResult = parseOutputDirInput(body.outputDir);
  if ("error" in outputDirResult) {
    return NextResponse.json({ error: outputDirResult.error }, { status: 400 });
  }
  const outputFormatResult = parseOutputFormatInput(body.outputFormat);
  if ("error" in outputFormatResult) {
    return NextResponse.json({ error: outputFormatResult.error }, { status: 400 });
  }
  const keepResultsResult = parseKeepResultsInput(body.keepResults);
  if ("error" in keepResultsResult) {
    return NextResponse.json({ error: keepResultsResult.error }, { status: 400 });
  }

  const docs = await db.query.documents.findMany({ where: inArray(documents.id, documentIds) });
  if (docs.length !== documentIds.length) {
    return NextResponse.json({ error: "Some documents were not found" }, { status: 400 });
  }

  const [batch] = await db.insert(batches).values({
    name: name.trim(),
    templateSnapshot,
    totalCount: docs.length,
    outputDir: outputDirResult.value,
    outputFormat: outputFormatResult.value,
    keepResults: keepResultsResult.value,
  }).returning();

  await db.insert(jobs).values(docs.map((d) => ({
    documentId: d.id,
    templateSnapshot,
    source: "batch" as const,
    batchId: batch.id,
  })));

  void processPendingJobs(240_000);

  return NextResponse.json({ batchId: batch.id });
}

export async function GET() {
  const list = await db.query.batches.findMany({ orderBy: desc(batches.createdAt) });
  return NextResponse.json({ batches: list });
}

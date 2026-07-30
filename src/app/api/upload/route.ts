import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { documents, schedules } from "@/db/schema";
import { saveBuffer } from "@/lib/storage";

const MAX_SIZE_BYTES = 32 * 1024 * 1024;

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart form data with a \"file\" field." },
      { status: 400 }
    );
  }
  const file = formData.get("file");
  const scheduleId = formData.get("scheduleId");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A file is required." }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "File must be a PDF." }, { status: 400 });
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "File must be 32MB or smaller." }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.subarray(0, 4).toString() !== "%PDF") {
    return NextResponse.json({ error: "File is not a valid PDF." }, { status: 400 });
  }

  let scheduleIdValue: string | null = null;
  if (typeof scheduleId === "string" && scheduleId.length > 0) {
    const schedule = await db.query.schedules.findFirst({ where: eq(schedules.id, scheduleId) });
    if (!schedule) {
      return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
    }
    scheduleIdValue = scheduleId;
  }

  const { filePath, sizeBytes } = saveBuffer(buf);

  const [document] = await db
    .insert(documents)
    .values({
      filename: file.name,
      filePath,
      sizeBytes,
      scheduleId: scheduleIdValue,
    })
    .returning();

  return NextResponse.json({ document });
}

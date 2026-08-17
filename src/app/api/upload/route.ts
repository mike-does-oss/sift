import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { documents, schedules } from "@/db/schema";
import { requireUser } from "@/lib/user";
import { saveBuffer } from "@/lib/storage";
import { detectExtension } from "@/lib/documents";
import { sizeLimitFor } from "@/lib/upload-limits";

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

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

  const buf = Buffer.from(await file.arrayBuffer());

  let ext: string;
  try {
    ext = detectExtension(buf, file.name);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unsupported file type.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const { maxBytes, label } = sizeLimitFor(ext);
  if (file.size > maxBytes) {
    return NextResponse.json({ error: `File must be ${label} or smaller.` }, { status: 400 });
  }

  let scheduleIdValue: string | null = null;
  if (typeof scheduleId === "string" && scheduleId.length > 0) {
    // Another tenant's schedule is indistinguishable from a nonexistent one.
    const schedule = await db.query.schedules.findFirst({
      where: and(eq(schedules.id, scheduleId), eq(schedules.userId, user.id)),
    });
    if (!schedule) {
      return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
    }
    scheduleIdValue = scheduleId;
  }

  const { filePath, sizeBytes } = await saveBuffer(buf, file.name, ext);

  const [document] = await db
    .insert(documents)
    .values({
      userId: user.id,
      filename: file.name,
      filePath,
      sizeBytes,
      scheduleId: scheduleIdValue,
    })
    .returning();

  return NextResponse.json({ document });
}

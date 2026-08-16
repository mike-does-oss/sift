import { NextResponse } from "next/server";
import { requireUser } from "@/lib/user";
import { maskedSettings, updateSettings, type SiftSettings } from "@/lib/settings";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  return NextResponse.json({ settings: await maskedSettings(user.id) });
}

// Note: GET returns masked keys ("…xxxx" for a set key, "" for unset), so the
// UI must treat "…xxxx" as a "key present" sentinel and only PATCH a key
// field when the user actually typed a new value — never round-trip the
// masked value back as if it were real.
export async function PATCH(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  let body: Partial<SiftSettings>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  try {
    await updateSettings(body, user.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid settings update.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json({ settings: await maskedSettings(user.id) });
}

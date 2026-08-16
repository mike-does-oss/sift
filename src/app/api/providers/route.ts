import { NextResponse } from "next/server";
import { requireUser } from "@/lib/user";
import { getSettings } from "@/lib/settings";
import { getProviderInfo } from "@/lib/providers-info";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const providers = await getProviderInfo(await getSettings(user.id));
  return NextResponse.json({ providers });
}

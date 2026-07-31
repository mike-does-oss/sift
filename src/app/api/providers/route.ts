import { NextResponse } from "next/server";
import { getSettings } from "@/lib/settings";
import { getProviderInfo } from "@/lib/providers-info";

export async function GET() {
  const providers = await getProviderInfo(getSettings());
  return NextResponse.json({ providers });
}

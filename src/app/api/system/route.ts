import os from "os";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/user";
import { recommendModels, type SystemInfo } from "@/lib/model-recommend";

// Machine-hardware readout for the download flow's model recommendations.
// No tenant data involved, but gated like every other handler for a uniform
// auth surface (free on local: requireUser resolves instantly).
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const system: SystemInfo = {
    totalRamGB: Math.round(os.totalmem() / 1024 ** 3),
    arch: process.arch,
    platform: process.platform,
  };
  const recommendations = recommendModels(system);
  return NextResponse.json({ system, recommendations });
}

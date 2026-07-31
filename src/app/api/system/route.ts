import os from "os";
import { NextResponse } from "next/server";
import { recommendModels, type SystemInfo } from "@/lib/model-recommend";

// Machine-hardware readout for the download flow's model recommendations —
// no settings/keys involved, so this is safe to call unauthenticated.
export async function GET() {
  const system: SystemInfo = {
    totalRamGB: Math.round(os.totalmem() / 1024 ** 3),
    arch: process.arch,
    platform: process.platform,
  };
  const recommendations = recommendModels(system);
  return NextResponse.json({ system, recommendations });
}

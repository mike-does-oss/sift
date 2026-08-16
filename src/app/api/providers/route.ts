import { NextResponse } from "next/server";
import { requireUser } from "@/lib/user";
import { getSettings } from "@/lib/settings";
import { getProviderInfo } from "@/lib/providers-info";
import { isHosted } from "@/lib/profile";
import { byoKeyActive } from "@/lib/gates";
import { PLANS, BYO_KEY_MODEL, type Plan } from "@/lib/plans";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  // Hosted (§SaaS-1 T6, decision 8): Anthropic-only, and the one model a
  // request can run is a billing decision (plan tier, BYO → opus) — so the
  // list is exactly that model. Returned WITHOUT going through
  // `getProviderInfo`, which would probe a localhost Ollama (a pointless
  // ~2s timeout in a lambda hot path) and read tenant provider settings.
  if (isHosted() && user.plan !== "local") {
    const model = byoKeyActive(user) ? BYO_KEY_MODEL : PLANS[user.plan as Plan].model;
    return NextResponse.json({
      providers: [
        { id: "anthropic", label: "Claude", privacy: "cloud", models: [model], configured: true },
      ],
    });
  }

  const providers = await getProviderInfo(await getSettings(user.id));
  return NextResponse.json({ providers });
}

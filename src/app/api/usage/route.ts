import { NextResponse } from "next/server";
import { requireUser } from "@/lib/user";
import { getMonthlyUsage } from "@/lib/usage";
import { byoKeyActive } from "@/lib/gates";
import { PLANS } from "@/lib/plans";

// §SaaS-1 T5 (donor: extracto-app). Plan + usage meter for the settings UI.
// The local profile is unmetered: it returns an `unlimited` shape the UI can
// branch on instead of numbers that don't exist there.

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  if (user.plan === "local") {
    return NextResponse.json({ plan: "local", unlimited: true });
  }

  const used = await getMonthlyUsage(user.id);
  return NextResponse.json({
    used,
    limit: PLANS[user.plan].monthlyExtractions,
    plan: user.plan,
    byoKeyActive: byoKeyActive(user),
    hasBilling: Boolean(user.stripeCustomerId),
  });
}

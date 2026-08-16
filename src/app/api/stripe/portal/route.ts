import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { requireUser } from "@/lib/user";
import { isHosted } from "@/lib/profile";

// §SaaS-1 T5 (donor: extracto-app). Opens the Stripe Billing Portal for a
// user who already has a Stripe customer.

export async function POST(req: NextRequest) {
  if (!isHosted()) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  if (!user.stripeCustomerId) return NextResponse.json({ error: "No billing account" }, { status: 400 });
  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${req.nextUrl.origin}/dashboard/settings`,
  });
  return NextResponse.json({ url: session.url });
}

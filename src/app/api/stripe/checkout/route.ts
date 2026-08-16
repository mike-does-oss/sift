import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { db } from "@/db";
import * as pgSchema from "@/db/schema.pg";
import { users } from "@/db/schema.pg";
import { stripe } from "@/lib/stripe";
import { requireUser } from "@/lib/user";
import { priceIdForPlan } from "@/lib/plans";
import { isHosted } from "@/lib/profile";

// §SaaS-1 T5 (donor: extracto-app). Creates a Stripe Checkout session for a
// plan upgrade. The webhook — never this route — is the sole writer of
// `users.plan`; all this route persists is the Stripe customer id, BEFORE
// the session is created, so the webhook can always resolve the user.

// The `users` table is pg-only; this route 404s on local before touching it.
const pgDb = () => db as unknown as NeonHttpDatabase<typeof pgSchema>;

export async function POST(req: NextRequest) {
  if (!isHosted()) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { plan } = await req.json();
  if (plan !== "starter" && plan !== "pro" && plan !== "business") {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  }

  const origin = req.nextUrl.origin;

  // Already actively subscribed → plan changes go through the Billing
  // Portal (proration, invoices), not a second checkout.
  if (
    user.stripeSubscriptionId &&
    (user.subscriptionStatus === "active" || user.subscriptionStatus === "trialing")
  ) {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId!,
      return_url: `${origin}/dashboard/settings`,
    });
    return NextResponse.json({ url: portalSession.url, portal: true });
  }

  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: user.email ?? undefined, metadata: { userId: user.id } });
    customerId = customer.id;
    await pgDb().update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, user.id));
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceIdForPlan(plan), quantity: 1 }],
    success_url: `${origin}/dashboard/settings?checkout=success`,
    cancel_url: `${origin}/dashboard/settings?checkout=canceled`,
    client_reference_id: user.id,
  });
  return NextResponse.json({ url: session.url });
}

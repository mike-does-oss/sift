import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { db } from "@/db";
import * as pgSchema from "@/db/schema.pg";
import { users } from "@/db/schema.pg";
import { stripe } from "@/lib/stripe";
import { planFromPriceId } from "@/lib/plans";
import { isHosted } from "@/lib/profile";

// §SaaS-1 T5 (donor: extracto-app, three events verbatim). THE SOLE WRITER
// of `users.plan` — no other code path may ever mutate it. Self-authorizing
// by Stripe signature (no auth middleware / session): `constructEvent`
// verifies the payload against STRIPE_WEBHOOK_SECRET, 400 on any mismatch.
// Writes are idempotent sets keyed on our own ids (client_reference_id /
// stripeCustomerId); out-of-order subscription events can transiently set an
// older status, converging on the next event (donor-accepted caveat).

// The `users` table is pg-only; this route 404s on local before touching it.
const pgDb = () => db as unknown as NeonHttpDatabase<typeof pgSchema>;

export async function POST(req: NextRequest) {
  if (!isHosted()) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.text();
  const sig = req.headers.get("stripe-signature");
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig!, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      // Link customer to user (client_reference_id set at checkout creation)
      if (session.client_reference_id && typeof session.customer === "string") {
        await pgDb().update(users)
          .set({ stripeCustomerId: session.customer })
          .where(eq(users.id, session.client_reference_id));
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const plan = planFromPriceId(sub.items.data[0]?.price.id);
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      const active = sub.status === "active" || sub.status === "trialing";
      await pgDb().update(users)
        .set({
          plan: active && plan ? plan : "free",
          stripeSubscriptionId: sub.id,
          subscriptionStatus: sub.status,
        })
        .where(eq(users.stripeCustomerId, customerId));
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      await pgDb().update(users)
        .set({ plan: "free", stripeSubscriptionId: null, subscriptionStatus: "canceled" })
        .where(eq(users.stripeCustomerId, customerId));
      break;
    }
  }
  return NextResponse.json({ received: true });
}

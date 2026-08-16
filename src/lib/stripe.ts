import Stripe from "stripe";

// Lazy-Proxy Stripe client (§SaaS-1 T5, donor: extracto-app, verbatim):
// the SDK is only constructed on first property access, so importing this
// module never requires STRIPE_SECRET_KEY at build time (or on the local
// profile, where the Stripe routes 404 before ever touching it).

let stripeInstance: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripeInstance) {
    stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY!);
  }
  return stripeInstance;
}

export const stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    return getStripe()[prop as keyof Stripe];
  },
}) as Stripe;

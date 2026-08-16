import Stripe from "stripe";
import { PLANS } from "../src/lib/plans";

// §SaaS-1 T5 (donor: extracto-app). Creates the Stripe products + monthly
// prices for the paid tiers from PLANS and prints the env lines to copy into
// the deployment's environment. Run with the target account's key:
//
//   STRIPE_SECRET_KEY=sk_test_... npx tsx scripts/setup-stripe.ts
//
// NOT idempotent: every run creates a fresh product + price. Run it once per
// Stripe account (test mode, then live), or archive the duplicates.

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

async function main() {
  for (const plan of ["starter", "pro", "business"] as const) {
    const cfg = PLANS[plan];
    const product = await stripe.products.create({
      name: `Sift ${cfg.name}`,
      metadata: { plan },
    });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: cfg.priceMonthly * 100,
      currency: "usd",
      recurring: { interval: "month" },
    });
    console.log(`STRIPE_PRICE_${plan.toUpperCase()}=${price.id}`);
  }
}

main();

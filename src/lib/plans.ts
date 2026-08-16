// Hosted-profile plan config (§SaaS-1 T5, donor: extracto-app). Single source
// of truth for tier limits: every gate in the app (quota checks, batch size
// limits, schedule access, BYO-key eligibility, pricing copy) reads from
// `PLANS` — never a hardcoded number. The local profile's synthetic "local"
// plan is deliberately NOT in this record: it bypasses every gate and no
// billing code path may ever look it up here.

export type Plan = "free" | "starter" | "pro" | "business";

export interface PlanConfig {
  name: string;
  priceMonthly: number; // USD
  monthlyExtractions: number;
  byoKey: boolean;
  batch: boolean;
  batchLimit: number; // max files per batch, 0 = no batch
  schedules: boolean;
  model: string; // Claude model used for extraction on this plan
}

export const PLANS: Record<Plan, PlanConfig> = {
  free: { name: "Free", priceMonthly: 0, monthlyExtractions: 10, byoKey: false, batch: false, batchLimit: 0, schedules: false, model: "claude-haiku-4-5" },
  starter: { name: "Starter", priceMonthly: 19, monthlyExtractions: 200, byoKey: true, batch: false, batchLimit: 0, schedules: false, model: "claude-haiku-4-5" },
  pro: { name: "Pro", priceMonthly: 49, monthlyExtractions: 1000, byoKey: true, batch: true, batchLimit: 25, schedules: false, model: "claude-sonnet-5" },
  business: { name: "Business", priceMonthly: 149, monthlyExtractions: 5000, byoKey: true, batch: true, batchLimit: 100, schedules: true, model: "claude-sonnet-5" },
};

/**
 * Extractions run with a bring-your-own key always use this model regardless
 * of plan tier, and are quota-exempt (`jobs.usedByoKey` frozen at enqueue).
 */
export const BYO_KEY_MODEL = "claude-opus-4-8";

const PAID_PLANS: Exclude<Plan, "free">[] = ["starter", "pro", "business"];

const priceEnvVar: Record<Exclude<Plan, "free">, string> = {
  starter: "STRIPE_PRICE_STARTER",
  pro: "STRIPE_PRICE_PRO",
  business: "STRIPE_PRICE_BUSINESS",
};

export function planFromPriceId(priceId: string | null | undefined): Plan | null {
  if (!priceId) return null;
  for (const plan of PAID_PLANS) {
    if (process.env[priceEnvVar[plan]] === priceId) return plan;
  }
  return null;
}

export function priceIdForPlan(plan: Exclude<Plan, "free">): string {
  const id = process.env[priceEnvVar[plan]];
  if (!id) throw new Error(`Missing env var ${priceEnvVar[plan]}`);
  return id;
}

export function remainingQuota(plan: Plan, usedThisMonth: number): number {
  return Math.max(0, PLANS[plan].monthlyExtractions - usedThisMonth);
}

/** Human-readable feature bullets for a plan, derived from its config. */
export function planFeatures(plan: Plan): string[] {
  const cfg = PLANS[plan];
  const features: string[] = [`${cfg.monthlyExtractions.toLocaleString()} extractions / month`];
  if (cfg.byoKey) features.push("Bring your own API key");
  if (cfg.batch) features.push(`Batch uploads — up to ${cfg.batchLimit} files at once`);
  if (cfg.schedules) features.push("Scheduled, recurring extractions");
  return features;
}

/** The cheapest plan that includes bring-your-own-key (for upgrade-nudge copy). */
export function cheapestByoKeyPlan(): Plan {
  return (Object.keys(PLANS) as Plan[])
    .filter((p) => PLANS[p].byoKey)
    .reduce((min, p) => (PLANS[p].priceMonthly < PLANS[min].priceMonthly ? p : min));
}

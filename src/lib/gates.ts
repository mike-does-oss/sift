import { PLANS, remainingQuota, cheapestByoKeyPlan, type Plan } from "@/lib/plans";

// Hosted-profile plan gates (§SaaS-1 T5, donor: extracto-app). Pure decision
// functions so the free/starter/pro/business × operation matrix is testable
// without route mocking; the API routes fetch whatever async inputs a gate
// needs (monthly usage) and translate a `GateDenial` into their JSON error
// shape. Every limit comes from `PLANS` — no hardcoded numbers.
//
// The local profile's synthetic "local" plan bypasses ALL gates: every
// function here returns "allowed" for it, pinning the invariant that the
// local profile stays gate-free and byte-equivalent in behavior.

/** The user shape the gates need — satisfied by `AppUser` and the pg `users` row. */
export interface GateUser {
  plan: Plan | "local";
  encryptedAnthropicKey: string | null;
}

export interface GateDenial {
  status: 400 | 402 | 403;
  error: string;
  code?: "QUOTA_EXCEEDED" | "UPGRADE_REQUIRED";
}

/**
 * Whether extractions for this user run on their bring-your-own key right
 * now: a stored key AND a plan that includes BYO. This is the value frozen
 * onto `jobs.usedByoKey` at enqueue (extract route, batches route, schedule
 * inbox enqueue) — BYO jobs are quota-exempt and run on `BYO_KEY_MODEL`.
 * Always false on the local profile (no key vault there).
 */
export function byoKeyActive(user: GateUser): boolean {
  if (user.plan === "local") return false;
  return Boolean(user.encryptedAnthropicKey && PLANS[user.plan].byoKey);
}

/**
 * Quota gate for enqueueing `needed` platform-key extractions. Callers must
 * skip it entirely when `byoKeyActive(user)` (BYO is quota-exempt).
 */
export function quotaGate(plan: Plan | "local", usedThisMonth: number, needed: number): GateDenial | null {
  if (plan === "local") return null;
  const remaining = remainingQuota(plan, usedThisMonth);
  if (remaining >= needed) return null;
  const error = needed === 1
    ? `Monthly limit of ${PLANS[plan].monthlyExtractions} extractions reached. Upgrade your plan or add your own API key.`
    : `This batch needs ${needed} extractions but you have ${remaining} left this month.`;
  return { status: 402, error, code: "QUOTA_EXCEEDED" };
}

/** Feature + size gate for creating a batch of `docCount` documents. */
export function batchGate(plan: Plan | "local", docCount: number): GateDenial | null {
  if (plan === "local") return null;
  const cfg = PLANS[plan];
  if (!cfg.batch) {
    return { status: 403, error: "Batch processing requires the Pro plan or higher.", code: "UPGRADE_REQUIRED" };
  }
  if (docCount > cfg.batchLimit) {
    return { status: 400, error: `Your plan allows up to ${cfg.batchLimit} files per batch.` };
  }
  return null;
}

/** Feature gate for creating/updating/manually running schedules. */
export function scheduleGate(plan: Plan | "local"): GateDenial | null {
  if (plan === "local") return null;
  if (PLANS[plan].schedules) return null;
  return { status: 403, error: "Scheduled processing requires the Business plan.", code: "UPGRADE_REQUIRED" };
}

/** Feature gate for storing a bring-your-own Anthropic key. */
export function byoKeyGate(plan: Plan | "local"): GateDenial | null {
  if (plan === "local") return null;
  if (PLANS[plan].byoKey) return null;
  const cheapest = PLANS[cheapestByoKeyPlan()].name;
  return { status: 403, error: `Bring-your-own-key requires the ${cheapest} plan or higher.`, code: "UPGRADE_REQUIRED" };
}

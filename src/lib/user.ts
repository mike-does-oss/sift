import { eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { db } from "@/db";
import * as pgSchema from "@/db/schema.pg";
import { users } from "@/db/schema.pg";
import { isHosted } from "@/lib/profile";

// Paid-tier ids live on the pg `users` table; the full plan config module
// (`src/lib/plans.ts`) arrives with billing (§SaaS-1 T5) — until then the
// union is defined here so `AppUser` already has its final shape.
export type PlanId = "free" | "starter" | "pro" | "business";

export interface AppUser {
  id: string;
  email: string | null;
  plan: PlanId | "local";
  encryptedAnthropicKey: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: string | null;
}

export type AuthResult = { ok: true; user: AppUser } | { ok: false; response: Response };

// The local profile is single-user with zero auth friction: every row belongs
// to the constant user "local", so tenancy-scoping code is identical across
// profiles. `plan: "local"` is the synthetic unlimited plan — no gate in the
// app may ever restrict it.
const LOCAL_USER: AppUser = {
  id: "local",
  email: null,
  plan: "local",
  encryptedAnthropicKey: null,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  subscriptionStatus: null,
};

// The `users` table exists only in the pg schema, so this module talks to the
// runtime db under its true hosted type (the shared selector types against
// the sqlite anchor, which has no `users`). Only reachable on hosted.
const pgDb = () => db as unknown as NeonHttpDatabase<typeof pgSchema>;

/**
 * The single auth seam every API route goes through:
 *
 *   const auth = await requireUser();
 *   if (!auth.ok) return auth.response;
 *   const { user } = auth;
 *
 * Local profile: resolves instantly to the fixed "local" user — no DB, no
 * session. Hosted: validates the Neon Auth session (401 without one) and
 * lazily provisions the `users` row keyed on `authId` (race-safe:
 * findFirst → insert onConflictDoNothing → re-select).
 */
export async function requireUser(): Promise<AuthResult> {
  if (!isHosted()) return { ok: true, user: LOCAL_USER };

  // Dynamic import: the Neon Auth SDK never loads on the local profile (it
  // drags in next/headers and needs hosted-only env vars).
  const { getAuth } = await import("@/lib/auth/server");
  const { data: session } = await getAuth().getSession();
  if (!session?.user) {
    return {
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const row = await getOrCreateDbUser(session.user.id, session.user.email ?? "");
  return {
    ok: true,
    user: {
      id: row.id,
      email: row.email || null,
      plan: row.plan,
      encryptedAnthropicKey: row.encryptedAnthropicKey,
      stripeCustomerId: row.stripeCustomerId,
      stripeSubscriptionId: row.stripeSubscriptionId,
      subscriptionStatus: row.subscriptionStatus,
    },
  };
}

async function getOrCreateDbUser(authId: string, email: string): Promise<pgSchema.DbUser> {
  const existing = await pgDb().query.users.findFirst({ where: eq(users.authId, authId) });
  if (existing) {
    // Keep `users.email` in sync with the auth session on every hit — the
    // row's email otherwise stays frozen at first provision, and billing
    // (Stripe customer creation, receipts) needs the current address. Only
    // a real, changed session email writes; never clobber with "".
    if (email && existing.email !== email) {
      const [updated] = await pgDb().update(users).set({ email }).where(eq(users.id, existing.id)).returning();
      return updated ?? { ...existing, email };
    }
    return existing;
  }

  const [created] = await pgDb()
    .insert(users)
    .values({ authId, email })
    .onConflictDoNothing({ target: users.authId })
    .returning();
  if (created) return created;
  // Lost the provisioning race — the winner's row is committed; re-read it.
  return (await pgDb().query.users.findFirst({ where: eq(users.authId, authId) }))!;
}

/**
 * Hosted-only lookup of a `users` row by primary key — the billing/BYO-key
 * seam for code paths that hold a userId but no session (the jobs worker's
 * per-job key/model resolution, `resolveProvider`'s hosted branch). The
 * `users` table only exists in the pg schema, so calling this on the local
 * profile is a bug, not a fallback.
 */
export async function getDbUserById(id: string): Promise<pgSchema.DbUser | undefined> {
  if (!isHosted()) {
    throw new Error("getDbUserById is hosted-only (the local profile has no users table)");
  }
  return pgDb().query.users.findFirst({ where: eq(users.id, id) });
}

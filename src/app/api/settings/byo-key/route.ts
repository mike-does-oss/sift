import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { db } from "@/db";
import * as pgSchema from "@/db/schema.pg";
import { users } from "@/db/schema.pg";
import { requireUser } from "@/lib/user";
import { byoKeyGate } from "@/lib/gates";
import { encryptSecret, decryptSecret, maskKey } from "@/lib/crypto";
import { BYO_KEY_MODEL } from "@/lib/plans";
import { isHosted } from "@/lib/profile";

// §SaaS-1 T5 key vault routes (donor: extracto-app). Hosted-only — the local
// profile keeps its settings-table provider keys and 404s here. The key is
// validated live against the Anthropic API before being encrypted at rest
// (AES-256-GCM, src/lib/crypto.ts); GET only ever returns a masked form.

// The `users` table is pg-only; these routes 404 on local before touching it.
const pgDb = () => db as unknown as NeonHttpDatabase<typeof pgSchema>;

export async function PUT(req: NextRequest) {
  if (!isHosted()) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const denial = byoKeyGate(user.plan);
  if (denial) {
    return NextResponse.json({ error: denial.error, code: denial.code }, { status: denial.status });
  }

  const { apiKey } = await req.json();
  if (typeof apiKey !== "string" || !apiKey.startsWith("sk-ant-")) {
    return NextResponse.json({ error: "That doesn't look like an Anthropic API key." }, { status: 400 });
  }
  try {
    // Live validation against the exact model BYO extractions will use.
    await new Anthropic({ apiKey }).models.retrieve(BYO_KEY_MODEL);
  } catch {
    return NextResponse.json({ error: "Key validation failed — Anthropic rejected this key." }, { status: 400 });
  }
  await pgDb().update(users).set({ encryptedAnthropicKey: encryptSecret(apiKey) }).where(eq(users.id, user.id));
  return NextResponse.json({ masked: maskKey(apiKey) });
}

export async function GET() {
  if (!isHosted()) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const masked = user.encryptedAnthropicKey ? maskKey(decryptSecret(user.encryptedAnthropicKey)) : null;
  return NextResponse.json({ masked });
}

export async function DELETE() {
  if (!isHosted()) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  await pgDb().update(users).set({ encryptedAnthropicKey: null }).where(eq(users.id, user.id));
  return NextResponse.json({ ok: true });
}

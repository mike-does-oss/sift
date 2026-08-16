import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { PROVIDER_IDS, isProviderId, type ProviderId } from "@/lib/api";
import { isHosted } from "@/lib/profile";

export interface SiftSettings {
  provider: ProviderId;
  ollamaBaseUrl: string; // default "http://localhost:11434"
  ollamaModel: string; // default "gemma3:4b"
  anthropicApiKey: string; // default ""
  anthropicModel: string; // default "claude-sonnet-5"
  openaiApiKey: string; // default ""
  openaiModel: string; // default "gpt-4o"
  geminiApiKey: string; // default ""
  geminiModel: string; // default "gemini-2.0-flash"
  compatBaseUrl: string; // default ""
  compatApiKey: string; // default ""
  compatModel: string; // default ""
}

export const DEFAULT_SETTINGS: SiftSettings = {
  provider: "ollama",
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "gemma3:4b",
  anthropicApiKey: "",
  anthropicModel: "claude-sonnet-5",
  openaiApiKey: "",
  openaiModel: "gpt-4o",
  geminiApiKey: "",
  geminiModel: "gemini-2.0-flash",
  compatBaseUrl: "",
  compatApiKey: "",
  compatModel: "",
};

/**
 * Tenancy scope for the settings k/v store. Callers on authenticated paths
 * pass `user.id` from `requireUser()`; the jobs worker passes the job row's
 * `userId`. Omitting it is only legal on the local profile (where every row
 * belongs to the constant user "local") — on hosted an unscoped read/write is
 * a missing tenant stamp and must fail loudly, never fall back to a shared
 * row.
 */
function scopeUserId(userId?: string): string {
  if (userId) return userId;
  if (isHosted()) {
    throw new Error("settings access requires a userId on the hosted profile");
  }
  return "local";
}

/** Reads one user's rows from the `settings` table into a plain key/value record. */
async function readRows(userId: string): Promise<Record<string, string>> {
  const rows = await db.select().from(settings).where(eq(settings.userId, userId));
  const record: Record<string, string> = {};
  for (const row of rows) record[row.key] = row.value;
  return record;
}

export async function getSettings(userId?: string): Promise<SiftSettings> {
  const record = await readRows(scopeUserId(userId));
  const merged = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof SiftSettings)[]) {
    if (key in record) {
      (merged as Record<keyof SiftSettings, string>)[key] = record[key];
    }
  }
  if (!isProviderId(merged.provider)) {
    throw new Error(`Invalid provider value stored in settings: "${merged.provider}"`);
  }
  return merged;
}

export async function updateSettings(patch: Partial<SiftSettings>, userId?: string): Promise<SiftSettings> {
  const uid = scopeUserId(userId);
  const validKeys = new Set(Object.keys(DEFAULT_SETTINGS));
  for (const key of Object.keys(patch)) {
    if (!validKeys.has(key)) {
      throw new Error(`Unknown setting key: "${key}"`);
    }
  }
  if (patch.provider !== undefined && !isProviderId(patch.provider)) {
    throw new Error(`Invalid provider: "${patch.provider}". Must be one of ${PROVIDER_IDS.join(", ")}.`);
  }
  // Empty string is legal only for these fields — either an API key (empty
  // means "clear the key") or the openai-compatible endpoint config (empty
  // means "unconfigured"; that provider is simply unusable without them).
  // Every other setting must have a real value.
  const CLEARABLE_SETTINGS = new Set<keyof SiftSettings>([
    "anthropicApiKey",
    "openaiApiKey",
    "geminiApiKey",
    "compatBaseUrl",
    "compatApiKey",
    "compatModel",
  ]);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (typeof value !== "string") {
      throw new Error(`Setting "${key}" must be a string, got ${typeof value}.`);
    }
    if (value === "" && !CLEARABLE_SETTINGS.has(key as keyof SiftSettings)) {
      throw new Error(`Setting "${key}" cannot be empty.`);
    }
  }

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    // Conflict target matches the composite PK (user_id, key), which both
    // dialects now share (sqlite migration 0005) — targeting `key` alone
    // would be rejected at runtime on pg.
    await db.insert(settings)
      .values({ key, value, userId: uid })
      .onConflictDoUpdate({ target: [settings.userId, settings.key], set: { value } });
  }

  return getSettings(uid);
}

function maskKey(key: string): string {
  return key ? `…${key.slice(-4)}` : "";
}

/**
 * Settings safe to send to the client: API keys are replaced by "" (unset)
 * or "…last4" (set). The UI must treat "…xxxx" as a "key present" sentinel
 * and only PATCH a key field when the user actually typed a new value —
 * never round-trip the masked value back as if it were the real key.
 */
export async function maskedSettings(userId?: string): Promise<SiftSettings> {
  const current = await getSettings(scopeUserId(userId));
  return {
    ...current,
    anthropicApiKey: maskKey(current.anthropicApiKey),
    openaiApiKey: maskKey(current.openaiApiKey),
    geminiApiKey: maskKey(current.geminiApiKey),
    compatApiKey: maskKey(current.compatApiKey),
  };
}

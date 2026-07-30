import { db } from "@/db";
import { settings } from "@/db/schema";

export interface SiftSettings {
  provider: "ollama" | "anthropic" | "openai";
  ollamaBaseUrl: string; // default "http://localhost:11434"
  ollamaModel: string; // default "gemma3:4b"
  anthropicApiKey: string; // default ""
  anthropicModel: string; // default "claude-sonnet-5"
  openaiApiKey: string; // default ""
  openaiModel: string; // default "gpt-4o"
}

export const DEFAULT_SETTINGS: SiftSettings = {
  provider: "ollama",
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "gemma3:4b",
  anthropicApiKey: "",
  anthropicModel: "claude-sonnet-5",
  openaiApiKey: "",
  openaiModel: "gpt-4o",
};

const PROVIDERS = ["ollama", "anthropic", "openai"] as const;

function isValidProvider(value: unknown): value is SiftSettings["provider"] {
  return typeof value === "string" && (PROVIDERS as readonly string[]).includes(value);
}

/** Reads all rows from the `settings` table into a plain key/value record. */
function readRows(): Record<string, string> {
  const rows = db.select().from(settings).all();
  const record: Record<string, string> = {};
  for (const row of rows) record[row.key] = row.value;
  return record;
}

export function getSettings(): SiftSettings {
  const record = readRows();
  const merged = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof SiftSettings)[]) {
    if (key in record) {
      (merged as Record<keyof SiftSettings, string>)[key] = record[key];
    }
  }
  if (!isValidProvider(merged.provider)) {
    throw new Error(`Invalid provider value stored in settings: "${merged.provider}"`);
  }
  return merged;
}

export function updateSettings(patch: Partial<SiftSettings>): SiftSettings {
  const validKeys = new Set(Object.keys(DEFAULT_SETTINGS));
  for (const key of Object.keys(patch)) {
    if (!validKeys.has(key)) {
      throw new Error(`Unknown setting key: "${key}"`);
    }
  }
  if (patch.provider !== undefined && !isValidProvider(patch.provider)) {
    throw new Error(`Invalid provider: "${patch.provider}". Must be one of ${PROVIDERS.join(", ")}.`);
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (typeof value !== "string") {
      throw new Error(`Setting "${key}" must be a string, got ${typeof value}.`);
    }
  }

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    db.insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
      .run();
  }

  return getSettings();
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
export function maskedSettings(): SiftSettings {
  const current = getSettings();
  return {
    ...current,
    anthropicApiKey: maskKey(current.anthropicApiKey),
    openaiApiKey: maskKey(current.openaiApiKey),
  };
}

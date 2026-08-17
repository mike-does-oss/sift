import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { datasets } from "@/db/schema";

// §INBOX T3: shared validation for a schedule's email-in delivery settings
// (POST create + PATCH edit). Mirrors the parse*Input idiom in
// output-writer.ts — return { value } or { error }, and only touch a field
// when the request actually included its key, so e.g. PATCHing just
// `{ active }` (the existing toggle flow) never resets delivery settings.

export const INGEST_MODES = ["auto", "attachments", "email", "both"] as const;
export type IngestMode = (typeof INGEST_MODES)[number];

export interface DeliverySettingsPatch {
  ingestMode?: IngestMode;
  processOnArrival?: boolean;
  allowedSenders?: string | null;
  datasetId?: string | null;
  notifyEmail?: boolean;
}

/**
 * Normalizes the allowed-senders comma list: trim + lowercase each entry,
 * strip a leading "@" (the natural way to write a domain rule — the webhook
 * matcher treats any entry containing "@" as an exact-address rule, so
 * "@acme.com" must be stored as "acme.com" to act as a domain rule), drop
 * empties. Nothing left → null (accept any sender).
 */
export function normalizeAllowedSenders(raw: string): string | null {
  const entries = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
  return entries.length > 0 ? entries.join(", ") : null;
}

/**
 * Validates whichever delivery-settings keys are present in a request body.
 * `datasetId` is ownership-checked server-side: a cross-tenant id gets the
 * exact same "Dataset not found" answer as a nonexistent one (existence not
 * revealed).
 */
export async function parseDeliverySettingsInput(
  body: Record<string, unknown>,
  userId: string
): Promise<{ value: DeliverySettingsPatch } | { error: string }> {
  const patch: DeliverySettingsPatch = {};

  if ("ingestMode" in body) {
    const value = body.ingestMode;
    if (typeof value !== "string" || !(INGEST_MODES as readonly string[]).includes(value)) {
      return { error: "ingestMode must be one of: auto, attachments, email, both" };
    }
    patch.ingestMode = value as IngestMode;
  }

  for (const field of ["processOnArrival", "notifyEmail"] as const) {
    if (field in body) {
      const value = body[field];
      if (typeof value !== "boolean") return { error: `${field} must be true or false` };
      patch[field] = value;
    }
  }

  if ("allowedSenders" in body) {
    const value = body.allowedSenders;
    if (value !== null && typeof value !== "string") {
      return { error: "allowedSenders must be a comma-separated string or null" };
    }
    patch.allowedSenders = value === null ? null : normalizeAllowedSenders(value);
  }

  if ("datasetId" in body) {
    const value = body.datasetId;
    if (value === null || value === "") {
      patch.datasetId = null;
    } else if (typeof value !== "string") {
      return { error: "datasetId must be a dataset id or null" };
    } else {
      const owned = await db.query.datasets.findFirst({
        where: and(eq(datasets.id, value), eq(datasets.userId, userId)),
      });
      if (!owned) return { error: "Dataset not found" };
      patch.datasetId = value;
    }
  }

  return { value: patch };
}

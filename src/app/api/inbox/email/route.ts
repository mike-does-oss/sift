import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { documents, schedules } from "@/db/schema";
import { isHosted } from "@/lib/profile";
import { saveBuffer } from "@/lib/storage";
import { detectExtension } from "@/lib/documents";
import { sizeLimitFor } from "@/lib/upload-limits";
import * as resend from "@/lib/resend";
import { enqueueScheduleArrival, kickJobWorker } from "@/lib/jobs";

// §INBOX: Resend `email.received` webhook — the ingestion door for schedule
// email-in addresses (<inboundToken>@RESEND_INBOUND_DOMAIN).
//
// This is an UNAUTHENTICATED public endpoint; its security posture, in order:
//   1. hosted-only (local profile → 404 before anything runs)
//   2. Svix-style HMAC signature over the RAW body, verified BEFORE any
//      parsing — anything unsigned/tampered/stale is a 401
//   3. well-signed events we choose to ignore (unknown alias, sender not
//      allowed, duplicate) are 200s so Resend doesn't retry and the route
//      never becomes an alias-existence oracle
//   4. tenant identity comes ONLY from the schedule row the token resolves
//      to — never from any payload field
//   5. content bytes are only fetched from allowlisted Resend hosts (SSRF
//      rail lives in src/lib/resend.ts) and run through the same
//      magic-byte/allowlist/size pipeline as manual uploads.
//
// Ingestion never enqueues jobs here (T2 wires processOnArrival).

const MAX_ATTACHMENTS_PER_EMAIL = 10;
const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

/**
 * Svix-convention webhook signature (Resend signs with Svix): HMAC-SHA256
 * over `${svix-id}.${svix-timestamp}.${rawBody}`, keyed with the base64
 * secret after the `whsec_` prefix; the signature header carries one or more
 * space-separated `v1,<base64>` candidates. Constant-time compare; ±5 min
 * timestamp tolerance. Implemented by hand — one HMAC doesn't justify a
 * dependency.
 */
function verifySvixSignature(
  secret: string,
  msgId: string,
  timestamp: string,
  signatureHeader: string,
  payload: string
): boolean {
  const ts = Number(timestamp);
  if (!Number.isInteger(ts)) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - ts) > TIMESTAMP_TOLERANCE_SECONDS) return false;

  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret, "base64");
  if (key.length === 0) return false;
  const expected = createHmac("sha256", key).update(`${msgId}.${timestamp}.${payload}`).digest();

  for (const candidate of signatureHeader.split(" ")) {
    const [version, sig] = candidate.split(",");
    if (version !== "v1" || !sig) continue;
    const provided = Buffer.from(sig, "base64");
    if (provided.length === expected.length && timingSafeEqual(provided, expected)) return true;
  }
  return false;
}

/** `"Ana Lytics" <ana@acme.com>` → `ana@acme.com` (lowercased). */
function extractAddress(from: string): string {
  const angled = from.match(/<([^<>]+)>/);
  return (angled ? angled[1] : from).trim().toLowerCase();
}

/**
 * Plan §2 sender rule: comma list, case-insensitive; an entry containing "@"
 * must match the full address exactly, otherwise it matches as a substring
 * of the sender's domain. Empty/null list = accept any sender (the token is
 * the credential).
 */
function senderAllowed(allowedSenders: string | null, from: string): boolean {
  if (!allowedSenders?.trim()) return true;
  const sender = extractAddress(from);
  const domain = sender.split("@")[1] ?? "";
  return allowedSenders
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => (entry.includes("@") ? sender === entry : domain.includes(entry)));
}

function localPartOf(recipient: string): string {
  const address = extractAddress(recipient);
  const at = address.indexOf("@");
  return at === -1 ? address : address.slice(0, at);
}

/** `.eml` filename from the subject (sanitized) or the provider email id. */
function emlFilename(subject: string | undefined, emailId: string): string {
  const base = (subject ?? "")
    .replace(/[^a-zA-Z0-9._ -]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, "");
  return `${base || emailId}.eml`;
}

interface ReceivedEventData {
  email_id?: string;
  from?: string;
  to?: string[] | string;
  subject?: string;
  attachments?: Array<{ id?: string; filename?: string; content_type?: string }>;
}

function ignored(reason: string, detail?: string): NextResponse {
  console.log(`[inbox/email] ignored: ${reason}${detail ? ` (${detail})` : ""}`);
  return NextResponse.json({ ignored: true });
}

export async function POST(request: Request) {
  if (!isHosted()) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.log("[inbox/email] RESEND_WEBHOOK_SECRET is not set — rejecting delivery");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  // Signature first — over the raw body, before any parsing.
  const rawBody = await request.text();
  const msgId = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signature = request.headers.get("svix-signature");
  if (!msgId || !timestamp || !signature || !verifySvixSignature(secret, msgId, timestamp, signature, rawBody)) {
    console.log("[inbox/email] rejected: bad or missing webhook signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: { type?: string; data?: ReceivedEventData };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return ignored("unparseable payload");
  }
  if (event.type !== "email.received") return ignored("event type", event.type ?? "none");

  const data = event.data ?? {};
  const emailId = data.email_id;
  if (!emailId) return ignored("payload missing email_id");

  // Resolve the schedule from the recipient token. Everything about the
  // tenant comes from the matched row — never from the payload.
  const recipients = Array.isArray(data.to) ? data.to : typeof data.to === "string" ? [data.to] : [];
  let schedule = null;
  for (const recipient of recipients) {
    const token = localPartOf(recipient);
    if (!token) continue;
    schedule = (await db.query.schedules.findFirst({ where: eq(schedules.inboundToken, token) })) ?? null;
    if (schedule) break;
  }
  if (!schedule) return ignored("no schedule for recipient");

  if (!senderAllowed(schedule.allowedSenders, data.from ?? "")) {
    return ignored("sender not in allowedSenders", `schedule ${schedule.id}`);
  }

  // Idempotency: a redelivered webhook (same provider email id, same
  // schedule) creates nothing.
  const existing = await db.query.documents.findFirst({
    where: and(eq(documents.sourceMessageId, emailId), eq(documents.scheduleId, schedule.id)),
  });
  if (existing) return ignored("duplicate delivery", `email ${emailId}`);

  let ingested = 0;
  let skipped = 0;

  async function ingest(buf: Buffer, filename: string, ext: string): Promise<void> {
    const { filePath, sizeBytes } = await saveBuffer(buf, filename, ext);
    await db.insert(documents).values({
      userId: schedule!.userId, // tenant stamp: from the schedule row ONLY
      filename,
      filePath,
      sizeBytes,
      scheduleId: schedule!.id,
      sourceMessageId: emailId!,
    });
    ingested++;
  }

  // Content policy (plan §3): what this email turns into.
  const mode = schedule.ingestMode;
  const wantsAttachments = mode === "auto" || mode === "attachments" || mode === "both";
  const hasAttachments = (data.attachments?.length ?? 0) > 0;

  if (wantsAttachments && hasAttachments) {
    let metas: resend.ReceivedAttachmentMeta[] = [];
    try {
      metas = await resend.listReceivedAttachments(emailId);
    } catch (err) {
      skipped += data.attachments!.length;
      console.log(`[inbox/email] skipped all attachments: list failed (${err instanceof Error ? err.message : err})`);
    }
    if (metas.length > MAX_ATTACHMENTS_PER_EMAIL) {
      skipped += metas.length - MAX_ATTACHMENTS_PER_EMAIL;
      console.log(`[inbox/email] skipped ${metas.length - MAX_ATTACHMENTS_PER_EMAIL} attachments: over the ${MAX_ATTACHMENTS_PER_EMAIL}-per-email cap`);
      metas = metas.slice(0, MAX_ATTACHMENTS_PER_EMAIL);
    }
    for (const meta of metas) {
      try {
        const buf = await resend.fetchReceivedAttachment(meta.downloadUrl);
        const ext = detectExtension(buf, meta.filename); // magic bytes first; throws on unsupported
        const { maxBytes, label } = sizeLimitFor(ext);
        if (buf.length > maxBytes) {
          skipped++;
          console.log(`[inbox/email] skipped attachment "${meta.filename}": larger than ${label}`);
          continue;
        }
        await ingest(buf, meta.filename, ext);
      } catch (err) {
        skipped++;
        console.log(`[inbox/email] skipped attachment "${meta.filename}": ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  // The email itself as .eml: always for `email`/`both`; for `auto` only
  // when no attachment made it in (body-borne data).
  const wantsEml = mode === "email" || mode === "both" || (mode === "auto" && ingested === 0);
  if (wantsEml) {
    try {
      const raw = await resend.fetchReceivedRawMime(emailId);
      const { maxBytes, label } = sizeLimitFor("eml");
      if (raw.length > maxBytes) {
        skipped++;
        console.log(`[inbox/email] skipped .eml for ${emailId}: larger than ${label}`);
      } else {
        await ingest(raw, emlFilename(data.subject, emailId), "eml");
      }
    } catch (err) {
      skipped++;
      console.log(`[inbox/email] skipped .eml for ${emailId}: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (ingested === 0 && skipped === 0) {
    console.log(`[inbox/email] nothing to ingest for ${emailId} (mode ${mode}, no matching content)`);
  }

  // §T2 process-on-arrival: enqueue the just-ingested docs immediately via
  // the quota-capped path (`enqueueScheduleArrival` — deliberately does NOT
  // stamp lastRunAt, so the cadence contract stays intact) and kick the
  // worker. Best-effort by design: ingestion has already succeeded, so an
  // enqueue failure logs and still 200s — the docs simply wait in the inbox
  // for the next cadence run.
  if (ingested > 0 && schedule.processOnArrival) {
    try {
      const jobsCreated = await enqueueScheduleArrival(schedule.id);
      if (jobsCreated > 0) kickJobWorker(new URL(request.url).origin);
    } catch (err) {
      console.log(`[inbox/email] process-on-arrival enqueue failed for schedule ${schedule.id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  return NextResponse.json({ ingested, skipped });
}

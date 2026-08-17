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
// Byte cap handed to the Resend attachment download (pre-checked against
// Content-Length, enforced by a capped stream read) — matches the largest
// per-type ingestion limit, so nothing this would abort could ever ingest.
const MAX_ATTACHMENT_FETCH_BYTES = 32 * 1024 * 1024;

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
 * must match the full address exactly, otherwise it matches the sender's
 * domain exactly or as a dot-boundary suffix (subdomain). A bare substring
 * match would let `x@acme.com.evil.net` (or `x@notacme.com`) satisfy an
 * `acme.com` entry. Empty/null list = accept any sender (the token is the
 * credential).
 */
function senderAllowed(allowedSenders: string | null, from: string): boolean {
  if (!allowedSenders?.trim()) return true;
  const sender = extractAddress(from);
  const domain = sender.split("@")[1] ?? "";
  return allowedSenders
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => (entry.includes("@") ? sender === entry : domain === entry || domain.endsWith("." + entry)));
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
  cc?: string[] | string;
  bcc?: string[] | string;
  /** Envelope recipients from the Received headers — how a FORWARDED email
   *  names the inbox alias (its To: still shows the original recipient). */
  received_for?: string[] | string;
  subject?: string;
  attachments?: Array<{ id?: string; filename?: string; content_type?: string }>;
}

function asList(v: string[] | string | undefined): string[] {
  return Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
}

/**
 * Mixup guardrail #1 — candidate recipients are the union of To/Cc/Bcc AND
 * `received_for` (forwarding rules deliver the alias in the envelope, not the
 * visible To: header). Guardrail #2 — an address is only a token candidate
 * when its DOMAIN is exactly this deployment's inbound domain: a forwarded
 * email's original recipient (`billing@customer.com`) must never be looked up
 * as a token, no matter what its local part is. Guardrail #3 — subaddress
 * tags (`token+march@…`) are stripped, so tagged forwards still route.
 */
function candidateTokens(data: ReceivedEventData, inboundDomain: string): string[] {
  const domain = inboundDomain.trim().toLowerCase();
  const tokens: string[] = [];
  for (const recipient of [...asList(data.to), ...asList(data.cc), ...asList(data.bcc), ...asList(data.received_for)]) {
    const address = extractAddress(recipient);
    const at = address.indexOf("@");
    if (at === -1 || address.slice(at + 1) !== domain) continue;
    const token = address.slice(0, at).split("+")[0];
    if (token && !tokens.includes(token)) tokens.push(token);
  }
  return tokens;
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

  // Self-loop guard: our own run digests come from notifications@<inbound
  // domain>. A user who blanket-forwards their mailbox to a schedule address
  // would otherwise ingest each digest — and with process-on-arrival, every
  // digest would trigger a run that sends the next digest (metered spend
  // loop). From: is spoofable, so the worst an attacker gets from this check
  // is suppressing their own forged email — acceptable.
  const inboundDomain = (process.env.RESEND_INBOUND_DOMAIN ?? "").trim().toLowerCase();
  if (!inboundDomain) {
    console.log("[inbox/email] RESEND_INBOUND_DOMAIN is not set — cannot anchor recipients; ignoring delivery");
    return ignored("inbound domain not configured");
  }
  if (extractAddress(data.from ?? "") === `notifications@${inboundDomain}`) {
    return ignored("self-notification loop guard", `email ${emailId}`);
  }

  // Resolve EVERY schedule addressed by this email (mixup guardrail #4: an
  // email cc'd to two inbox addresses feeds both — first-match-only would
  // silently starve the second, possibly another tenant's). Everything about
  // each tenant comes from its own matched row — never from the payload.
  const tokens = candidateTokens(data, inboundDomain);
  const matched: Array<typeof schedules.$inferSelect> = [];
  for (const token of tokens) {
    const s = await db.query.schedules.findFirst({ where: eq(schedules.inboundToken, token) });
    if (s && !matched.some((m) => m.id === s.id)) matched.push(s);
  }
  if (matched.length === 0) return ignored("no schedule for any recipient");

  let ingested = 0;
  let skipped = 0;
  // Skip classification (review round): every skip is either
  //   - POLICY: a deterministic condition (oversize, unsupported type,
  //     bodiless-with-attachments-mode, per-email cap) — retrying can never
  //     change the outcome, so these must stay 200s (no retry storms), or
  //   - TRANSPORT: a throw from the Resend fetches (list / raw MIME /
  //     attachment bytes) — network/API failures a retry CAN fix. When
  //     nothing ingested and at least one transport failure fired, the route
  //     500s so Resend redelivers; the (sourceMessageId, scheduleId)
  //     idempotency check makes the eventual successful retry safe.
  let transportFailures = 0;

  function skipPolicy(count: number, detail: string): void {
    skipped += count;
    console.log(`[inbox/email] policy skip: ${detail}`);
  }

  function skipTransport(count: number, detail: string, err: unknown): void {
    skipped += count;
    transportFailures += count;
    console.log(`[inbox/email] transport failure: ${detail} (${err instanceof Error ? err.message : err})`);
  }

  /** Deterministic oversize abort from the capped download — policy, not transport. */
  function isTooLarge(err: unknown): boolean {
    return err instanceof Error && err.name === "AttachmentTooLargeError";
  }

  // Shared content fetchers, memoized across matched schedules: an email
  // cc'd to two inboxes downloads each attachment (and the raw MIME) exactly
  // once. A rejected promise is memoized too — every schedule sees the same
  // transport failure, which is the truthful outcome.
  const memo: {
    metas?: Promise<resend.ReceivedAttachmentMeta[]>;
    bufs: Map<string, Promise<Buffer>>;
    raw?: Promise<Buffer>;
  } = { bufs: new Map() };
  const getMetas = () => (memo.metas ??= resend.listReceivedAttachments(emailId));
  const getAttachment = (meta: resend.ReceivedAttachmentMeta) => {
    let p = memo.bufs.get(meta.downloadUrl);
    if (!p) {
      p = resend.fetchReceivedAttachment(meta.downloadUrl, MAX_ATTACHMENT_FETCH_BYTES);
      p.catch(() => {}); // memoized rejection must not become an unhandled rejection
      memo.bufs.set(meta.downloadUrl, p);
    }
    return p;
  };
  const getRaw = () => {
    if (!memo.raw) {
      memo.raw = resend.fetchReceivedRawMime(emailId);
      memo.raw.catch(() => {});
    }
    return memo.raw;
  };

  async function ingest(schedule: typeof schedules.$inferSelect, buf: Buffer, filename: string, ext: string): Promise<void> {
    const { filePath, sizeBytes } = await saveBuffer(buf, filename, ext);
    await db.insert(documents).values({
      userId: schedule.userId, // tenant stamp: from THIS schedule's row ONLY
      filename,
      filePath,
      sizeBytes,
      scheduleId: schedule.id,
      sourceMessageId: emailId!,
    });
    ingested++;
  }

  const arrivals: Array<typeof schedules.$inferSelect> = [];

  for (const schedule of matched) {
    if (!senderAllowed(schedule.allowedSenders, data.from ?? "")) {
      console.log(`[inbox/email] sender not in allowedSenders (schedule ${schedule.id})`);
      continue;
    }
    // Idempotency is PER SCHEDULE: a redelivered webhook creates nothing for
    // inboxes that already ingested this email, while a schedule that missed
    // out (e.g. earlier transport failure) can still catch up on retry.
    const existing = await db.query.documents.findFirst({
      where: and(eq(documents.sourceMessageId, emailId), eq(documents.scheduleId, schedule.id)),
    });
    if (existing) {
      console.log(`[inbox/email] duplicate delivery for schedule ${schedule.id} (email ${emailId})`);
      continue;
    }

    // Content policy (plan §3): what this email turns into, per schedule.
    const mode = schedule.ingestMode;
    const wantsAttachments = mode === "auto" || mode === "attachments" || mode === "both";
    const hasAttachments = (data.attachments?.length ?? 0) > 0;
    let scheduleIngested = 0;

    if (wantsAttachments && hasAttachments) {
      let metas: resend.ReceivedAttachmentMeta[] = [];
      try {
        metas = await getMetas();
      } catch (err) {
        skipTransport(data.attachments!.length, "attachment list failed", err);
      }
      if (metas.length > MAX_ATTACHMENTS_PER_EMAIL) {
        skipPolicy(metas.length - MAX_ATTACHMENTS_PER_EMAIL, `${metas.length - MAX_ATTACHMENTS_PER_EMAIL} attachments over the ${MAX_ATTACHMENTS_PER_EMAIL}-per-email cap`);
        metas = metas.slice(0, MAX_ATTACHMENTS_PER_EMAIL);
      }
      for (const meta of metas) {
        let buf: Buffer;
        try {
          buf = await getAttachment(meta);
        } catch (err) {
          if (isTooLarge(err)) skipPolicy(1, `attachment "${meta.filename}": ${(err as Error).message}`);
          else skipTransport(1, `attachment "${meta.filename}" download failed`, err);
          continue;
        }
        try {
          const ext = detectExtension(buf, meta.filename); // magic bytes first; throws on unsupported
          const { maxBytes, label } = sizeLimitFor(ext);
          if (buf.length > maxBytes) {
            skipPolicy(1, `attachment "${meta.filename}": larger than ${label}`);
            continue;
          }
          await ingest(schedule, buf, meta.filename, ext);
          scheduleIngested++;
        } catch (err) {
          skipPolicy(1, `attachment "${meta.filename}": ${err instanceof Error ? err.message : err}`);
        }
      }
    }

    // The email itself as .eml: always for `email`/`both`; for `auto` only
    // when no attachment made it into THIS schedule (body-borne data).
    const wantsEml = mode === "email" || mode === "both" || (mode === "auto" && scheduleIngested === 0);
    if (wantsEml) {
      let raw: Buffer | null = null;
      try {
        raw = await getRaw();
      } catch (err) {
        skipTransport(1, `.eml fetch for ${emailId} failed`, err);
      }
      if (raw) {
        try {
          const { maxBytes, label } = sizeLimitFor("eml");
          if (raw.length > maxBytes) {
            skipPolicy(1, `.eml for ${emailId}: larger than ${label}`);
          } else {
            await ingest(schedule, raw, emlFilename(data.subject, emailId), "eml");
            scheduleIngested++;
          }
        } catch (err) {
          skipPolicy(1, `.eml for ${emailId}: ${err instanceof Error ? err.message : err}`);
        }
      }
    }

    if (scheduleIngested > 0 && schedule.processOnArrival) arrivals.push(schedule);
  }

  // Nothing made it in AND at least one skip was a transport failure: 500 so
  // Resend retries the delivery — a retry can genuinely fix these, and the
  // idempotency check above makes the eventual success safe. (Partial
  // ingestion still 200s: a redelivery would be deduplicated wholesale, so
  // retrying could never recover the failed pieces anyway.)
  if (ingested === 0 && transportFailures > 0) {
    console.log(`[inbox/email] transport failure with nothing ingested for ${emailId} — 500 so the provider retries`);
    return NextResponse.json({ error: "Upstream fetch failed", ingested, skipped }, { status: 500 });
  }

  if (ingested === 0 && skipped === 0) {
    console.log(`[inbox/email] nothing to ingest for ${emailId} (no matching content for any schedule)`);
  }

  // §T2 process-on-arrival: enqueue each arrival schedule's just-ingested
  // docs immediately via the quota-capped path (`enqueueScheduleArrival` —
  // deliberately does NOT stamp lastRunAt, so the cadence contract stays
  // intact) and kick the worker once. Best-effort by design: ingestion has
  // already succeeded, so an enqueue failure logs and still 200s — the docs
  // simply wait in the inbox for the next cadence run.
  let jobsCreated = 0;
  for (const schedule of arrivals) {
    try {
      jobsCreated += await enqueueScheduleArrival(schedule.id);
    } catch (err) {
      console.log(`[inbox/email] process-on-arrival enqueue failed for schedule ${schedule.id}: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (jobsCreated > 0) kickJobWorker(new URL(request.url).origin);

  return NextResponse.json({ ingested, skipped });
}

// §INBOX: minimal Resend client surface (no SDK — three fetch calls). All
// functions are lazy and env-guarded: a missing env throws a clear error at
// call time, never at import (mirrors the lazily-initialized engine clients).
//
// Endpoints (Resend "Receiving emails" API):
//   GET  https://api.resend.com/emails/receiving/{id}               → received email incl. raw.download_url
//   GET  https://api.resend.com/emails/receiving/{id}/attachments   → attachment list incl. download_url
//   POST https://api.resend.com/emails                              → send (T2 digests)
// Download URLs are signed links on Resend's inbound CDN
// (inbound-cdn.resend.com).

const RESEND_API_BASE = "https://api.resend.com";

function apiKey(): string {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set — required for email-in ingestion and digests.");
  return key;
}

function inboundDomain(): string {
  const domain = process.env.RESEND_INBOUND_DOMAIN;
  if (!domain) throw new Error("RESEND_INBOUND_DOMAIN is not set — required to send email.");
  return domain;
}

/**
 * SSRF rail: an inbound webhook is unauthenticated-by-nature input, so any
 * URL we are asked to fetch bytes from must be a Resend-controlled https
 * host — never whatever the payload (or a tampered API response) says.
 * Exported for direct unit testing.
 */
export function assertResendUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Invalid Resend URL");
  }
  const host = url.hostname;
  const allowed = host === "api.resend.com" || host === "inbound-cdn.resend.com" || host.endsWith(".resend.com");
  if (url.protocol !== "https:" || !allowed) {
    throw new Error("Refusing to fetch from untrusted host (not a Resend URL)");
  }
  return url;
}

async function resendFetch(url: URL): Promise<Response> {
  // No redirects: the allowlist check must be the final word on where bytes come from.
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey()}` },
    redirect: "error",
  });
  if (!res.ok) throw new Error(`Resend request failed (status ${res.status})`);
  return res;
}

/**
 * §INBOX T3: the inbound domain for rendering schedule email-in addresses in
 * the UI — non-null only when every env the ingestion pipeline needs is set,
 * so the client never shows an address that can't actually receive. Read
 * server-side per request (never NEXT_PUBLIC-baked at build time).
 */
export function configuredInboundDomain(): string | null {
  const { RESEND_API_KEY, RESEND_WEBHOOK_SECRET, RESEND_INBOUND_DOMAIN } = process.env;
  return RESEND_API_KEY && RESEND_WEBHOOK_SECRET && RESEND_INBOUND_DOMAIN ? RESEND_INBOUND_DOMAIN : null;
}

export interface ReceivedAttachmentMeta {
  id: string;
  filename: string;
  contentType: string | null;
  downloadUrl: string;
}

/** Lists a received email's attachments (webhook payloads carry metadata only). */
export async function listReceivedAttachments(emailId: string): Promise<ReceivedAttachmentMeta[]> {
  const url = assertResendUrl(`${RESEND_API_BASE}/emails/receiving/${encodeURIComponent(emailId)}/attachments`);
  const body = (await (await resendFetch(url)).json()) as {
    data?: Array<{ id?: string; filename?: string; content_type?: string; download_url?: string }>;
  };
  return (body.data ?? [])
    .filter((a) => typeof a.download_url === "string" && a.download_url.length > 0)
    .map((a) => ({
      id: a.id ?? "",
      filename: a.filename ?? "attachment",
      contentType: a.content_type ?? null,
      downloadUrl: a.download_url!,
    }));
}

/**
 * Thrown when an attachment download exceeds the caller's byte cap — a
 * DETERMINISTIC oversize condition, not a transport failure. The webhook
 * route classifies on `.name` (not instanceof — the module is mocked in
 * route tests) to keep oversize a policy skip (200) rather than a
 * retryable 500.
 */
export class AttachmentTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentTooLargeError";
  }
}

/**
 * Downloads one attachment's bytes from its (allowlist-checked) signed URL.
 * `maxBytes` caps how much this will ever buffer: a `Content-Length` header
 * over the cap aborts before reading the body at all, and a missing/lying
 * header is caught by a capped stream read that cancels mid-flight the
 * moment the cap is crossed. Oversize throws `AttachmentTooLargeError`.
 */
export async function fetchReceivedAttachment(downloadUrl: string, maxBytes: number): Promise<Buffer> {
  const url = assertResendUrl(downloadUrl);
  const res = await resendFetch(url);

  const contentLength = res.headers.get("content-length");
  if (contentLength !== null) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      await res.body?.cancel().catch(() => {});
      throw new AttachmentTooLargeError(`Attachment is ${declared} bytes — over the ${maxBytes}-byte fetch cap`);
    }
  }

  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new AttachmentTooLargeError(`Attachment exceeds the ${maxBytes}-byte fetch cap`);
    return buf;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new AttachmentTooLargeError(`Attachment exceeds the ${maxBytes}-byte fetch cap`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Fetches the raw MIME of a received email (for `.eml` ingestion). */
export async function fetchReceivedRawMime(emailId: string): Promise<Buffer> {
  const url = assertResendUrl(`${RESEND_API_BASE}/emails/receiving/${encodeURIComponent(emailId)}`);
  const body = (await (await resendFetch(url)).json()) as { raw?: { download_url?: string } };
  const rawUrl = body.raw?.download_url;
  if (!rawUrl) throw new Error("Resend received-email response had no raw.download_url");
  return Buffer.from(await (await resendFetch(assertResendUrl(rawUrl))).arrayBuffer());
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  attachments?: Array<{ filename: string; content: string }>; // content = base64
}

/** Sends an email (T2 run digests). Minimal: one recipient, html body. */
export async function sendEmail({ to, subject, html, attachments }: SendEmailInput): Promise<void> {
  const res = await fetch(`${RESEND_API_BASE}/emails`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `Sift <notifications@${inboundDomain()}>`,
      to: [to],
      subject,
      html,
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Resend send failed (status ${res.status})`);
}

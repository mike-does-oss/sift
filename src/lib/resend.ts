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

/** Downloads one attachment's bytes from its (allowlist-checked) signed URL. */
export async function fetchReceivedAttachment(downloadUrl: string): Promise<Buffer> {
  const url = assertResendUrl(downloadUrl);
  return Buffer.from(await (await resendFetch(url)).arrayBuffer());
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

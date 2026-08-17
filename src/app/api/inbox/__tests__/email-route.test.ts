import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";

// §INBOX T1: the email-in webhook is an UNAUTHENTICATED public endpoint —
// these tests pin its security order (404 local → signature over the raw
// body → resolve → policy), the no-alias-oracle rule (well-signed ignores
// are 200s), idempotency, the ingest-mode policy matrix, the attachment
// caps, and that the tenant stamp comes from the schedule row only.

const state = vi.hoisted(() => ({
  scheduleFindFirst: vi.fn(),
  documentFindFirst: vi.fn(),
  inserts: [] as Array<Record<string, unknown>>,
  listReceivedAttachments: vi.fn(),
  fetchReceivedAttachment: vi.fn(),
  fetchReceivedRawMime: vi.fn(),
  saveBuffer: vi.fn(),
  enqueueScheduleArrival: vi.fn(),
  kickJobWorker: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    query: {
      schedules: { findFirst: state.scheduleFindFirst },
      documents: { findFirst: state.documentFindFirst },
    },
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        state.inserts.push(v);
        return Promise.resolve();
      },
    }),
  },
}));

vi.mock("@/lib/resend", () => ({
  listReceivedAttachments: state.listReceivedAttachments,
  fetchReceivedAttachment: state.fetchReceivedAttachment,
  fetchReceivedRawMime: state.fetchReceivedRawMime,
}));

vi.mock("@/lib/storage", () => ({ saveBuffer: state.saveBuffer }));

// §T2: the arrival-enqueue seam — mocked so the worker core (and its heavy
// import graph) never loads in these route tests.
vi.mock("@/lib/jobs", () => ({
  enqueueScheduleArrival: state.enqueueScheduleArrival,
  kickJobWorker: state.kickJobWorker,
}));

import { POST } from "../email/route";

const SECRET_BYTES = Buffer.from("0123456789abcdef0123456789abcdef");
const SECRET = `whsec_${SECRET_BYTES.toString("base64")}`;

function signedHeaders(payload: string, { id = "msg_1", timestamp = String(Math.floor(Date.now() / 1000)), signature }: { id?: string; timestamp?: string; signature?: string } = {}) {
  const sig = signature ?? createHmac("sha256", SECRET_BYTES).update(`${id}.${timestamp}.${payload}`).digest("base64");
  return { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${sig}` };
}

function post(payload: string, headers: Record<string, string>): Request {
  return new Request("http://localhost:4215/api/inbox/email", { method: "POST", body: payload, headers });
}

interface EventOverrides {
  emailId?: string;
  from?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  received_for?: string[];
  subject?: string;
  attachments?: Array<{ id: string; filename: string; content_type?: string }>;
  type?: string;
}

function receivedEvent({
  emailId = "em_1",
  from = "sender@acme.com",
  to = ["tokentokentokent@abc123.resend.app"],
  cc,
  bcc,
  received_for,
  subject = "July invoices",
  attachments = [],
  type = "email.received",
}: EventOverrides = {}): string {
  return JSON.stringify({
    type,
    created_at: new Date().toISOString(),
    data: { email_id: emailId, from, to, cc, bcc, received_for, subject, attachments },
  });
}

async function deliver(payload: string, headers?: Record<string, string>) {
  return POST(post(payload, headers ?? signedHeaders(payload)));
}

const SCHEDULE = {
  id: "sch_1",
  userId: "user_9",
  inboundToken: "tokentokentokent",
  ingestMode: "auto" as string,
  allowedSenders: null as string | null,
};

const PDF = Buffer.from("%PDF-1.4 tiny");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("png")]);
const MIME = Buffer.from("MIME-Version: 1.0\r\nSubject: July invoices\r\n\r\nbody");

const ATT_PDF = { id: "att_1", filename: "invoice.pdf", contentType: "application/pdf", downloadUrl: "https://inbound-cdn.resend.com/1" };
const ATT_PNG = { id: "att_2", filename: "receipt.png", contentType: "image/png", downloadUrl: "https://inbound-cdn.resend.com/2" };
const payloadAttachments = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `att_${i}`, filename: `f${i}.pdf` }));

beforeEach(() => {
  vi.stubEnv("SIFT_PROFILE", "hosted");
  vi.stubEnv("RESEND_WEBHOOK_SECRET", SECRET);
  // Mixup guardrails: recipients only resolve as tokens at THIS domain.
  vi.stubEnv("RESEND_INBOUND_DOMAIN", "abc123.resend.app");
  state.scheduleFindFirst.mockReset().mockResolvedValue({ ...SCHEDULE });
  state.documentFindFirst.mockReset().mockResolvedValue(undefined);
  state.inserts.length = 0;
  state.listReceivedAttachments.mockReset().mockResolvedValue([]);
  state.fetchReceivedAttachment.mockReset().mockResolvedValue(PDF);
  state.fetchReceivedRawMime.mockReset().mockResolvedValue(MIME);
  state.saveBuffer.mockReset().mockImplementation(async (buf: Buffer, filename: string) => ({
    filePath: `blob/${filename}`,
    sizeBytes: buf.length,
  }));
  state.enqueueScheduleArrival.mockReset().mockResolvedValue(1);
  state.kickJobWorker.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("local profile", () => {
  it("404s before any signature or DB work", async () => {
    vi.stubEnv("SIFT_PROFILE", "");
    const payload = receivedEvent();
    const res = await deliver(payload);
    expect(res.status).toBe(404);
    expect(state.scheduleFindFirst).not.toHaveBeenCalled();
  });
});

describe("signature verification (before any body handling)", () => {
  it("accepts a correctly signed payload", async () => {
    const res = await deliver(receivedEvent());
    expect(res.status).toBe(200);
  });

  it("rejects a tampered body with 401 and never looks up a schedule", async () => {
    const payload = receivedEvent();
    const headers = signedHeaders(payload);
    const tampered = payload.replace("sender@acme.com", "evil@acme.com");
    const res = await POST(post(tampered, headers));
    expect(res.status).toBe(401);
    expect(state.scheduleFindFirst).not.toHaveBeenCalled();
    expect(state.inserts).toEqual([]);
  });

  it("rejects a garbage signature with 401", async () => {
    const payload = receivedEvent();
    const res = await deliver(payload, signedHeaders(payload, { signature: Buffer.from("nope-nope-nope-nope-nope-nope!!!").toString("base64") }));
    expect(res.status).toBe(401);
    expect(state.scheduleFindFirst).not.toHaveBeenCalled();
  });

  it("rejects absent signature headers with 401", async () => {
    const res = await POST(post(receivedEvent(), {}));
    expect(res.status).toBe(401);
    expect(state.scheduleFindFirst).not.toHaveBeenCalled();
  });

  it("rejects a stale timestamp (replay) with 401 even when the HMAC is valid", async () => {
    const payload = receivedEvent();
    const stale = String(Math.floor(Date.now() / 1000) - 6 * 60);
    const res = await deliver(payload, signedHeaders(payload, { timestamp: stale }));
    expect(res.status).toBe(401);
    expect(state.scheduleFindFirst).not.toHaveBeenCalled();
  });

  it("500s (without leaking) when RESEND_WEBHOOK_SECRET is unset", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "");
    const res = await deliver(receivedEvent());
    expect(res.status).toBe(500);
    expect(state.scheduleFindFirst).not.toHaveBeenCalled();
  });
});

describe("token resolution (no alias oracle)", () => {
  it("unknown alias → 200 {ignored:true}, nothing ingested", async () => {
    state.scheduleFindFirst.mockResolvedValue(undefined);
    const res = await deliver(receivedEvent());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ignored: true });
    expect(state.inserts).toEqual([]);
    expect(state.fetchReceivedRawMime).not.toHaveBeenCalled();
  });

  it("non-received event types → 200 ignored, no schedule lookup", async () => {
    const res = await deliver(receivedEvent({ type: "email.bounced" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ignored: true });
    expect(state.scheduleFindFirst).not.toHaveBeenCalled();
  });

  it("looks the schedule up by the recipient's lowercased local part", async () => {
    const { PgDialect } = await import("drizzle-orm/pg-core");
    let captured: unknown;
    state.scheduleFindFirst.mockImplementation(async (opts: { where: unknown }) => {
      captured = opts.where;
      return { ...SCHEDULE };
    });
    await deliver(receivedEvent({ to: ["ExtractoBot <TOKENTOKENTOKENT@abc123.resend.app>"] }));
    expect(new PgDialect().sqlToQuery(captured as import("drizzle-orm").SQL).params).toEqual(["tokentokentokent"]);
  });
});

describe("allowedSenders", () => {
  const cases: Array<{ list: string | null; from: string; allowed: boolean }> = [
    { list: null, from: "anyone@anywhere.io", allowed: true },
    { list: "  ", from: "anyone@anywhere.io", allowed: true },
    { list: "sender@acme.com", from: "sender@acme.com", allowed: true },
    { list: "sender@acme.com", from: "Other <other@acme.com>", allowed: false },
    { list: "SENDER@ACME.COM", from: "Sender <sender@acme.com>", allowed: true },
    { list: "acme.com", from: "bob@acme.com", allowed: true }, // exact domain
    { list: "acme.com", from: "bob@mail.acme.com", allowed: true }, // subdomain (dot-boundary suffix)
    { list: "acme.com", from: "bob@evil.io", allowed: false },
    { list: "acme.com", from: "acme.com@evil.io", allowed: false }, // local part can't satisfy a domain entry
    // Review round: suffix matching is dot-bounded — neither a spoof domain
    // that merely CONTAINS the entry nor a non-subdomain suffix may pass.
    { list: "acme.com", from: "x@acme.com.evil.net", allowed: false },
    { list: "acme.com", from: "x@notacme.com", allowed: false },
    { list: "billing@acme.com, partners.example", from: "kim@eu.partners.example", allowed: true },
    { list: "billing@acme.com, partners.example", from: "kim@other.example", allowed: false },
  ];

  it.each(cases)("list=$list from=$from → allowed=$allowed", async ({ list, from, allowed }) => {
    state.scheduleFindFirst.mockResolvedValue({ ...SCHEDULE, ingestMode: "email", allowedSenders: list });
    const res = await deliver(receivedEvent({ from }));
    expect(res.status).toBe(200);
    const body = await res.json();
    if (allowed) {
      expect(body).toEqual({ ingested: 1, skipped: 0 });
    } else {
      // Guardrail fan-out change: a rejected sender is a PER-SCHEDULE skip
      // (an email cc'd to a second schedule must still process there), so
      // the route reports zero ingestion rather than a top-level ignore.
      // The load-bearing assertion is unchanged: nothing was inserted.
      expect(body).toEqual({ ingested: 0, skipped: 0 });
      expect(state.inserts).toEqual([]);
    }
  });
});

describe("idempotency", () => {
  it("a redelivered email (same provider id, same schedule) ingests 0", async () => {
    state.documentFindFirst.mockResolvedValue({ id: "doc_1" });
    const res = await deliver(receivedEvent());
    // Per-schedule skip under the fan-out (see allowedSenders note): the
    // dedupe's real guarantees are below — no insert, no content fetches.
    expect(await res.json()).toEqual({ ingested: 0, skipped: 0 });
    expect(state.inserts).toEqual([]);
    expect(state.fetchReceivedRawMime).not.toHaveBeenCalled();
    expect(state.listReceivedAttachments).not.toHaveBeenCalled();
  });
});

describe("ingestMode policy matrix", () => {
  async function run(
    mode: string,
    attachments: EventOverrides["attachments"],
    metas: Array<typeof ATT_PDF>,
    fetchImpl: (url: string) => Promise<Buffer> = async (url) => (url.endsWith("/2") ? PNG : PDF)
  ) {
    state.scheduleFindFirst.mockResolvedValue({ ...SCHEDULE, ingestMode: mode });
    state.listReceivedAttachments.mockResolvedValue(metas);
    state.fetchReceivedAttachment.mockImplementation(fetchImpl);
    const res = await deliver(receivedEvent({ attachments }));
    return res.json();
  }

  const oneAtt = [{ id: "att_1", filename: "invoice.pdf" }];
  const twoAtt = [{ id: "att_1", filename: "invoice.pdf" }, { id: "att_2", filename: "receipt.png" }];

  describe("attachments-only email (1 supported attachment)", () => {
    it("auto → attachment only, no .eml", async () => {
      expect(await run("auto", oneAtt, [ATT_PDF])).toEqual({ ingested: 1, skipped: 0 });
      expect(state.fetchReceivedRawMime).not.toHaveBeenCalled();
    });
    it("attachments → attachment only", async () => {
      expect(await run("attachments", oneAtt, [ATT_PDF])).toEqual({ ingested: 1, skipped: 0 });
      expect(state.fetchReceivedRawMime).not.toHaveBeenCalled();
    });
    it("email → .eml only, attachments never fetched", async () => {
      expect(await run("email", oneAtt, [ATT_PDF])).toEqual({ ingested: 1, skipped: 0 });
      expect(state.listReceivedAttachments).not.toHaveBeenCalled();
      expect(state.fetchReceivedAttachment).not.toHaveBeenCalled();
      expect(state.inserts[0].filename).toMatch(/\.eml$/);
    });
    it("both → attachment + .eml", async () => {
      expect(await run("both", oneAtt, [ATT_PDF])).toEqual({ ingested: 2, skipped: 0 });
    });
  });

  describe("body-only email (no attachments)", () => {
    it("auto → falls back to .eml", async () => {
      expect(await run("auto", [], [])).toEqual({ ingested: 1, skipped: 0 });
      expect(state.inserts[0].filename).toBe("July invoices.eml");
    });
    it("attachments → bodiless drop, nothing ingested", async () => {
      expect(await run("attachments", [], [])).toEqual({ ingested: 0, skipped: 0 });
      expect(state.fetchReceivedRawMime).not.toHaveBeenCalled();
      expect(state.inserts).toEqual([]);
    });
    it("email → .eml", async () => {
      expect(await run("email", [], [])).toEqual({ ingested: 1, skipped: 0 });
    });
    it("both → just the .eml", async () => {
      expect(await run("both", [], [])).toEqual({ ingested: 1, skipped: 0 });
      expect(state.listReceivedAttachments).not.toHaveBeenCalled();
    });
  });

  describe("mixed email (2 supported attachments + body)", () => {
    it("auto → attachments win, no .eml", async () => {
      expect(await run("auto", twoAtt, [ATT_PDF, ATT_PNG])).toEqual({ ingested: 2, skipped: 0 });
      expect(state.fetchReceivedRawMime).not.toHaveBeenCalled();
    });
    it("attachments → both attachments", async () => {
      expect(await run("attachments", twoAtt, [ATT_PDF, ATT_PNG])).toEqual({ ingested: 2, skipped: 0 });
    });
    it("email → .eml only", async () => {
      expect(await run("email", twoAtt, [ATT_PDF, ATT_PNG])).toEqual({ ingested: 1, skipped: 0 });
      expect(state.fetchReceivedAttachment).not.toHaveBeenCalled();
    });
    it("both → attachments + .eml", async () => {
      expect(await run("both", twoAtt, [ATT_PDF, ATT_PNG])).toEqual({ ingested: 3, skipped: 0 });
    });
  });

  it("auto with only-unsupported attachments falls back to .eml", async () => {
    const garbage = async () => Buffer.from("garbage-bytes");
    expect(await run("auto", oneAtt, [{ ...ATT_PDF, filename: "weird.xyz" }], garbage)).toEqual({ ingested: 1, skipped: 1 });
    expect(state.fetchReceivedRawMime).toHaveBeenCalled();
    expect(state.inserts[0].filename).toMatch(/\.eml$/);
  });
});

describe("transport failures vs policy skips (review round)", () => {
  // TRANSPORT (a throw from the Resend fetches) with NOTHING ingested → 500
  // so Resend retries; idempotency makes the eventual successful retry safe.
  // Deterministic POLICY skips must keep returning 200 — no retry storms.

  it("attachment-list failure with nothing ingested → 500 (mode attachments)", async () => {
    state.scheduleFindFirst.mockResolvedValue({ ...SCHEDULE, ingestMode: "attachments" });
    state.listReceivedAttachments.mockRejectedValue(new Error("resend 503"));
    const res = await deliver(receivedEvent({ attachments: payloadAttachments(2) }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Upstream fetch failed", ingested: 0, skipped: 2 });
    expect(state.inserts).toEqual([]);
  });

  it("attachment-download failure with nothing ingested → 500 (mode attachments)", async () => {
    state.scheduleFindFirst.mockResolvedValue({ ...SCHEDULE, ingestMode: "attachments" });
    state.listReceivedAttachments.mockResolvedValue([ATT_PDF]);
    state.fetchReceivedAttachment.mockRejectedValue(new Error("socket hang up"));
    const res = await deliver(receivedEvent({ attachments: payloadAttachments(1) }));
    expect(res.status).toBe(500);
    expect(state.inserts).toEqual([]);
  });

  it("raw-MIME fetch failure with nothing ingested → 500 (mode email)", async () => {
    state.scheduleFindFirst.mockResolvedValue({ ...SCHEDULE, ingestMode: "email" });
    state.fetchReceivedRawMime.mockRejectedValue(new Error("ECONNRESET"));
    const res = await deliver(receivedEvent());
    expect(res.status).toBe(500);
    expect(state.inserts).toEqual([]);
  });

  it("auto: list failure but the .eml fallback ingests → 200 (partial success never retries)", async () => {
    state.scheduleFindFirst.mockResolvedValue({ ...SCHEDULE, ingestMode: "auto" });
    state.listReceivedAttachments.mockRejectedValue(new Error("resend 503"));
    const res = await deliver(receivedEvent({ attachments: payloadAttachments(1) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ingested: 1, skipped: 1 });
    expect(state.inserts[0].filename).toMatch(/\.eml$/);
  });

  it("both: a download failure alongside a successful .eml → 200 (a redelivery would dedupe wholesale)", async () => {
    state.scheduleFindFirst.mockResolvedValue({ ...SCHEDULE, ingestMode: "both" });
    state.listReceivedAttachments.mockResolvedValue([ATT_PDF]);
    state.fetchReceivedAttachment.mockRejectedValue(new Error("socket hang up"));
    const res = await deliver(receivedEvent({ attachments: payloadAttachments(1) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ingested: 1, skipped: 1 });
  });

  it("an over-cap download abort (AttachmentTooLargeError) is a POLICY skip → 200", async () => {
    state.scheduleFindFirst.mockResolvedValue({ ...SCHEDULE, ingestMode: "attachments" });
    state.listReceivedAttachments.mockResolvedValue([ATT_PDF]);
    const tooBig = new Error("Attachment exceeds the 33554432-byte fetch cap");
    tooBig.name = "AttachmentTooLargeError";
    state.fetchReceivedAttachment.mockRejectedValue(tooBig);
    const res = await deliver(receivedEvent({ attachments: payloadAttachments(1) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ingested: 0, skipped: 1 });
  });

  it("deterministic policy skips with nothing ingested stay 200 (unsupported type)", async () => {
    state.scheduleFindFirst.mockResolvedValue({ ...SCHEDULE, ingestMode: "attachments" });
    state.listReceivedAttachments.mockResolvedValue([{ ...ATT_PDF, filename: "weird.xyz" }]);
    state.fetchReceivedAttachment.mockResolvedValue(Buffer.from("garbage-bytes"));
    const res = await deliver(receivedEvent({ attachments: payloadAttachments(1) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ingested: 0, skipped: 1 });
  });

  it("passes the 32MB fetch cap to the attachment download", async () => {
    state.scheduleFindFirst.mockResolvedValue({ ...SCHEDULE, ingestMode: "attachments" });
    state.listReceivedAttachments.mockResolvedValue([ATT_PDF]);
    await deliver(receivedEvent({ attachments: payloadAttachments(1) }));
    expect(state.fetchReceivedAttachment).toHaveBeenCalledWith(ATT_PDF.downloadUrl, 32 * 1024 * 1024);
  });
});

describe("attachment guards", () => {
  it("skips oversize and unsupported attachments, keeps the good one", async () => {
    const bigPng = Buffer.concat([PNG, Buffer.alloc(8 * 1024 * 1024)]); // > 8MB image cap
    state.scheduleFindFirst.mockResolvedValue({ ...SCHEDULE, ingestMode: "attachments" });
    state.listReceivedAttachments.mockResolvedValue([
      ATT_PDF,
      { ...ATT_PNG, downloadUrl: "https://inbound-cdn.resend.com/big" },
      { id: "att_3", filename: "notes.xyz", contentType: null, downloadUrl: "https://inbound-cdn.resend.com/3" },
    ]);
    state.fetchReceivedAttachment.mockImplementation(async (url: string) => {
      if (url.endsWith("/big")) return bigPng;
      if (url.endsWith("/3")) return Buffer.from("no-magic-no-ext");
      return PDF;
    });
    const res = await deliver(receivedEvent({ attachments: payloadAttachments(3) }));
    expect(await res.json()).toEqual({ ingested: 1, skipped: 2 });
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0].filename).toBe("invoice.pdf");
  });

  it("caps ingestion at 10 attachments per email", async () => {
    state.scheduleFindFirst.mockResolvedValue({ ...SCHEDULE, ingestMode: "attachments" });
    state.listReceivedAttachments.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => ({ ...ATT_PDF, id: `att_${i}`, filename: `f${i}.pdf`, downloadUrl: `https://inbound-cdn.resend.com/${i}` }))
    );
    const res = await deliver(receivedEvent({ attachments: payloadAttachments(12) }));
    expect(await res.json()).toEqual({ ingested: 10, skipped: 2 });
    expect(state.fetchReceivedAttachment).toHaveBeenCalledTimes(10);
  });
});

describe("process on arrival (§T2)", () => {
  it("does NOT enqueue when the schedule's flag is off (default)", async () => {
    state.scheduleFindFirst.mockResolvedValue({ ...SCHEDULE, ingestMode: "email" });
    expect(await (await deliver(receivedEvent())).json()).toEqual({ ingested: 1, skipped: 0 });
    expect(state.enqueueScheduleArrival).not.toHaveBeenCalled();
    expect(state.kickJobWorker).not.toHaveBeenCalled();
  });

  it("enqueues via the arrival path and kicks the worker when the flag is set and something ingested", async () => {
    state.scheduleFindFirst.mockResolvedValue({ ...SCHEDULE, ingestMode: "email", processOnArrival: true });
    expect(await (await deliver(receivedEvent())).json()).toEqual({ ingested: 1, skipped: 0 });
    expect(state.enqueueScheduleArrival).toHaveBeenCalledExactlyOnceWith("sch_1");
    expect(state.kickJobWorker).toHaveBeenCalledExactlyOnceWith("http://localhost:4215");
  });

  it("does not enqueue when nothing was ingested (bodiless drop)", async () => {
    state.scheduleFindFirst.mockResolvedValue({ ...SCHEDULE, ingestMode: "attachments", processOnArrival: true });
    expect(await (await deliver(receivedEvent())).json()).toEqual({ ingested: 0, skipped: 0 });
    expect(state.enqueueScheduleArrival).not.toHaveBeenCalled();
  });

  it("does not kick the worker when the enqueue created no jobs", async () => {
    state.scheduleFindFirst.mockResolvedValue({ ...SCHEDULE, ingestMode: "email", processOnArrival: true });
    state.enqueueScheduleArrival.mockResolvedValue(0);
    expect(await (await deliver(receivedEvent())).json()).toEqual({ ingested: 1, skipped: 0 });
    expect(state.kickJobWorker).not.toHaveBeenCalled();
  });

  it("still 200s with the ingest counts when the enqueue fails — docs stay in the inbox for the next run", async () => {
    state.scheduleFindFirst.mockResolvedValue({ ...SCHEDULE, ingestMode: "email", processOnArrival: true });
    state.enqueueScheduleArrival.mockRejectedValue(new Error("quota lookup exploded"));
    const res = await deliver(receivedEvent());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ingested: 1, skipped: 0 });
    expect(state.kickJobWorker).not.toHaveBeenCalled();
  });
});

describe("tenant stamping", () => {
  it("documents get userId from the SCHEDULE row (never the payload), plus scheduleId and sourceMessageId", async () => {
    state.scheduleFindFirst.mockResolvedValue({ ...SCHEDULE, ingestMode: "both" });
    state.listReceivedAttachments.mockResolvedValue([ATT_PDF]);
    const res = await deliver(receivedEvent({ attachments: [{ id: "att_1", filename: "invoice.pdf" }], emailId: "em_42" }));
    expect(await res.json()).toEqual({ ingested: 2, skipped: 0 });
    for (const row of state.inserts) {
      expect(row.userId).toBe("user_9");
      expect(row.scheduleId).toBe("sch_1");
      expect(row.sourceMessageId).toBe("em_42");
    }
  });
});

// ---------------------------------------------------------------------------
// Mixup guardrails: the routing layer must never confuse inboxes — not across
// tenants, not across a user's own schedules, not for forwarded mail.
describe("mixup guardrails", () => {
  const DOMAIN = "abc123.resend.app";
  const B_SCHEDULE = { id: "sch_2", userId: "user_7", inboundToken: "othertokenother1", ingestMode: "email" as string, allowedSenders: null as string | null };

  it("routes a FORWARDED email via received_for (To: still shows the original recipient)", async () => {
    state.scheduleFindFirst.mockResolvedValue({ ...SCHEDULE, ingestMode: "email" });
    const res = await deliver(receivedEvent({
      to: ["mike@meridian.co"], // the pre-forwarding recipient — foreign domain
      received_for: [`tokentokentokent@${DOMAIN}`],
    }));
    expect(await res.json()).toEqual({ ingested: 1, skipped: 0 });
  });

  it("routes an inbox address that only appears in Cc", async () => {
    state.scheduleFindFirst.mockResolvedValue({ ...SCHEDULE, ingestMode: "email" });
    const res = await deliver(receivedEvent({ to: ["team@meridian.co"], cc: [`tokentokentokent@${DOMAIN}`] }));
    expect(await res.json()).toEqual({ ingested: 1, skipped: 0 });
  });

  it("NEVER token-looks-up a foreign-domain address, even with a token-shaped local part", async () => {
    const res = await deliver(receivedEvent({ to: ["tokentokentokent@evil.example"] }));
    expect(await res.json()).toEqual({ ignored: true });
    expect(state.scheduleFindFirst).not.toHaveBeenCalled();
    expect(state.inserts).toEqual([]);
  });

  it("routes subaddress tags to the base token", async () => {
    state.scheduleFindFirst.mockResolvedValue({ ...SCHEDULE, ingestMode: "email" });
    const res = await deliver(receivedEvent({ to: [`TokenTokenTokenT+march@${DOMAIN.toUpperCase()}`] }));
    expect(await res.json()).toEqual({ ingested: 1, skipped: 0 });
  });

  it("fans out to EVERY addressed schedule, each stamped with its own tenant", async () => {
    state.scheduleFindFirst
      .mockResolvedValueOnce({ ...SCHEDULE, ingestMode: "email" })
      .mockResolvedValueOnce({ ...B_SCHEDULE });
    const res = await deliver(receivedEvent({
      to: [`tokentokentokent@${DOMAIN}`],
      cc: [`othertokenother1@${DOMAIN}`],
    }));
    expect(await res.json()).toEqual({ ingested: 2, skipped: 0 });
    const stamps = state.inserts.map((r) => `${r.userId}/${r.scheduleId}`).sort();
    expect(stamps).toEqual(["user_7/sch_2", "user_9/sch_1"]);
  });

  it("one schedule's sender rejection doesn't starve the other", async () => {
    state.scheduleFindFirst
      .mockResolvedValueOnce({ ...SCHEDULE, ingestMode: "email", allowedSenders: "only@elsewhere.io" })
      .mockResolvedValueOnce({ ...B_SCHEDULE });
    const res = await deliver(receivedEvent({
      to: [`tokentokentokent@${DOMAIN}`, `othertokenother1@${DOMAIN}`],
    }));
    expect(await res.json()).toEqual({ ingested: 1, skipped: 0 });
    expect(state.inserts.map((r) => r.scheduleId)).toEqual(["sch_2"]);
  });

  it("the same address in To and Cc resolves once, not twice", async () => {
    state.scheduleFindFirst.mockResolvedValue({ ...SCHEDULE, ingestMode: "email" });
    const res = await deliver(receivedEvent({
      to: [`tokentokentokent@${DOMAIN}`],
      cc: [`Tokentokentokent@${DOMAIN}`],
    }));
    expect(await res.json()).toEqual({ ingested: 1, skipped: 0 });
    expect(state.scheduleFindFirst).toHaveBeenCalledTimes(1);
  });

  it("drops our own run digests (self-notification loop guard)", async () => {
    const res = await deliver(receivedEvent({
      from: `Sift <notifications@${DOMAIN}>`,
      to: [`tokentokentokent@${DOMAIN}`],
    }));
    expect(await res.json()).toEqual({ ignored: true });
    expect(state.scheduleFindFirst).not.toHaveBeenCalled();
  });

  it("missing RESEND_INBOUND_DOMAIN cannot anchor recipients — ignored, no lookups", async () => {
    vi.stubEnv("RESEND_INBOUND_DOMAIN", "");
    const res = await deliver(receivedEvent());
    expect(await res.json()).toEqual({ ignored: true });
    expect(state.scheduleFindFirst).not.toHaveBeenCalled();
  });
});

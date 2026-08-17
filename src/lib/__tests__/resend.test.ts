import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertResendUrl,
  fetchReceivedAttachment,
  fetchReceivedRawMime,
  listReceivedAttachments,
  sendEmail,
} from "@/lib/resend";

// §INBOX: the Resend client lib is the SSRF choke point for the inbound
// webhook — any URL it is asked to fetch must be an allowlisted https Resend
// host, and a rejection must happen BEFORE any network call. Envs are
// checked lazily at call time, never at import.

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  vi.stubEnv("RESEND_INBOUND_DOMAIN", "abc123.resend.app");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("assertResendUrl (SSRF allowlist)", () => {
  it.each([
    "https://api.resend.com/emails/receiving/em_1",
    "https://inbound-cdn.resend.com/em_1/attachments/att_1?sig=x",
  ])("allows %s", (url) => {
    expect(assertResendUrl(url).hostname.endsWith("resend.com")).toBe(true);
  });

  it.each([
    "http://api.resend.com/emails", // https only
    "https://evil.example.com/steal",
    "https://api.resend.com.evil.example/x", // suffix spoof
    "https://resend.com.evil.example/x",
    "https://169.254.169.254/latest/meta-data",
    "not a url",
  ])("rejects %s", (url) => {
    expect(() => assertResendUrl(url)).toThrow();
  });
});

describe("fetchReceivedAttachment", () => {
  const CAP = 32 * 1024 * 1024;

  it("never calls fetch for an untrusted host", async () => {
    await expect(fetchReceivedAttachment("https://attacker.example/payload.pdf", CAP)).rejects.toThrow(/untrusted host/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches an allowlisted URL with API-key auth, no redirects", async () => {
    fetchMock.mockResolvedValue(new Response(Buffer.from("%PDF-1.4")));
    const buf = await fetchReceivedAttachment("https://inbound-cdn.resend.com/em_1/attachments/att_1?sig=x", CAP);
    expect(buf.toString("latin1")).toBe("%PDF-1.4");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("inbound-cdn.resend.com");
    expect(init.headers.Authorization).toBe("Bearer re_test_key");
    expect(init.redirect).toBe("error");
  });

  it("throws a clear error when RESEND_API_KEY is missing — before any fetch", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    await expect(fetchReceivedAttachment("https://inbound-cdn.resend.com/x", CAP)).rejects.toThrow(/RESEND_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("byte cap (review round)", () => {
    it("aborts on an oversize Content-Length WITHOUT reading the body", async () => {
      // A hand-rolled response: a real undici Response pipes its source
      // stream internally, which would muddy the "never read" probe.
      const cancel = vi.fn(async () => {});
      const getReader = vi.fn();
      fetchMock.mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-length": String(CAP + 1) }),
        body: { cancel, getReader },
      });
      await expect(fetchReceivedAttachment("https://inbound-cdn.resend.com/x", CAP)).rejects.toMatchObject({
        name: "AttachmentTooLargeError",
      });
      expect(getReader).not.toHaveBeenCalled(); // aborted before buffering anything
      expect(cancel).toHaveBeenCalledTimes(1); // and the connection is released
    });

    it("a Content-Length exactly at the cap is not pre-rejected", async () => {
      const bytes = Buffer.alloc(64, 7);
      fetchMock.mockResolvedValue(new Response(bytes, { headers: { "content-length": "64" } }));
      const buf = await fetchReceivedAttachment("https://inbound-cdn.resend.com/x", 64);
      expect(buf.length).toBe(64);
    });

    it("caps a stream with no Content-Length: cancels mid-flight instead of buffering it all", async () => {
      let pulls = 0;
      const chunk = new Uint8Array(1024);
      const endless = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls++;
          controller.enqueue(chunk); // never closes — a lying/absent header must not buffer forever
        },
      });
      fetchMock.mockResolvedValue(new Response(endless));
      await expect(fetchReceivedAttachment("https://inbound-cdn.resend.com/x", 4 * 1024)).rejects.toMatchObject({
        name: "AttachmentTooLargeError",
      });
      expect(pulls).toBeLessThan(20); // aborted right past the cap, not later
    });
  });
});

describe("listReceivedAttachments", () => {
  it("hits the receiving attachments endpoint and maps download URLs", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: [
          { id: "att_1", filename: "invoice.pdf", content_type: "application/pdf", download_url: "https://inbound-cdn.resend.com/1" },
          { id: "att_2", filename: "no-url.bin" }, // no download_url → dropped
        ],
      })
    );
    const metas = await listReceivedAttachments("em_1");
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.resend.com/emails/receiving/em_1/attachments");
    expect(metas).toEqual([
      { id: "att_1", filename: "invoice.pdf", contentType: "application/pdf", downloadUrl: "https://inbound-cdn.resend.com/1" },
    ]);
  });
});

describe("fetchReceivedRawMime", () => {
  it("resolves raw.download_url from the received-email endpoint, then downloads it", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ raw: { download_url: "https://inbound-cdn.resend.com/em_1/raw?sig=x" } }))
      .mockResolvedValueOnce(new Response(Buffer.from("MIME-Version: 1.0")));
    const buf = await fetchReceivedRawMime("em_1");
    expect(buf.toString()).toContain("MIME-Version");
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.resend.com/emails/receiving/em_1");
    expect(String(fetchMock.mock.calls[1][0])).toContain("/em_1/raw");
  });

  it("refuses a raw download_url pointing at an untrusted host (no second fetch)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ raw: { download_url: "https://attacker.example/raw" } }));
    await expect(fetchReceivedRawMime("em_1")).rejects.toThrow(/untrusted host/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("sendEmail", () => {
  it("posts to /emails from the inbound domain", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "sent_1" }));
    await sendEmail({ to: "owner@example.com", subject: "Digest", html: "<p>hi</p>" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.resend.com/emails");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      from: "Sift <notifications@abc123.resend.app>",
      to: ["owner@example.com"],
      subject: "Digest",
    });
    expect(body.attachments).toBeUndefined();
  });

  it("throws clearly when RESEND_INBOUND_DOMAIN is missing", async () => {
    vi.stubEnv("RESEND_INBOUND_DOMAIN", "");
    await expect(sendEmail({ to: "a@b.c", subject: "s", html: "" })).rejects.toThrow(/RESEND_INBOUND_DOMAIN/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

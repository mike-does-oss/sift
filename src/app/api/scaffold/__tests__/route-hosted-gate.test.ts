import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// §SaaS-1 T5-review fix: /api/scaffold is a real platform-key LLM call, so on
// hosted it takes the same quota gate as /api/extract (gate only — it never
// meters), discards user overrides, and exempts BYO users. Separate file from
// route.test.ts because these tests mock requireUser/getMonthlyUsage while
// that file relies on the real local-profile fixed user.

const requireUser = vi.hoisted(() => vi.fn());
vi.mock("@/lib/user", () => ({ requireUser }));

const getMonthlyUsage = vi.hoisted(() => vi.fn());
vi.mock("@/lib/usage", () => ({ getMonthlyUsage }));

vi.mock("@/lib/extraction/scaffold", async () => {
  const actual = await vi.importActual<typeof import("@/lib/extraction/scaffold")>("@/lib/extraction/scaffold");
  return {
    ...actual,
    scaffoldSchema: vi.fn().mockResolvedValue({ success: true, fields: [], prompt: "p", extractMultiple: false }),
  };
});

import { POST } from "../route";
import { scaffoldSchema } from "@/lib/extraction/scaffold";

const hostedUser = (plan: string, encryptedAnthropicKey: string | null) => ({
  ok: true,
  user: { id: "u1", email: "u@example.com", plan, encryptedAnthropicKey, stripeCustomerId: null, stripeSubscriptionId: null, subscriptionStatus: null },
});

function req(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/scaffold", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const DESC = "Extract the vendor name and total from invoices.";

describe("POST /api/scaffold — hosted quota gate (T5 review finding 2)", () => {
  beforeEach(() => {
    vi.mocked(scaffoldSchema).mockClear();
    requireUser.mockReset();
    getMonthlyUsage.mockReset();
  });

  it("free plan at quota → 402 QUOTA_EXCEEDED, no LLM call", async () => {
    requireUser.mockResolvedValue(hostedUser("free", null));
    getMonthlyUsage.mockResolvedValue(10);
    const res = await POST(req({ description: DESC }));
    expect(res.status).toBe(402);
    expect((await res.json()).code).toBe("QUOTA_EXCEEDED");
    expect(scaffoldSchema).not.toHaveBeenCalled();
  });

  it("free plan under quota → 200, and any user-supplied override is discarded", async () => {
    requireUser.mockResolvedValue(hostedUser("free", null));
    getMonthlyUsage.mockResolvedValue(0);
    const res = await POST(req({ description: DESC, provider: "openai", model: "gpt-4o" }));
    expect(res.status).toBe(200);
    expect(scaffoldSchema).toHaveBeenCalledWith(DESC, undefined, "u1");
  });

  it("BYO-active user skips the quota lookup entirely", async () => {
    requireUser.mockResolvedValue(hostedUser("starter", "encrypted-blob"));
    const res = await POST(req({ description: DESC }));
    expect(res.status).toBe(200);
    expect(getMonthlyUsage).not.toHaveBeenCalled();
    expect(scaffoldSchema).toHaveBeenCalledWith(DESC, undefined, "u1");
  });

  it("local plan bypasses the gate and keeps overrides", async () => {
    requireUser.mockResolvedValue(hostedUser("local", null));
    const res = await POST(req({ description: DESC, provider: "ollama" }));
    expect(res.status).toBe(200);
    expect(getMonthlyUsage).not.toHaveBeenCalled();
    expect(scaffoldSchema).toHaveBeenCalledWith(DESC, { provider: "ollama", model: undefined }, "u1");
  });
});

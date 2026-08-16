import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { randomBytes } from "crypto";

// §SaaS-1 T6 hosted provider-surface policy (plan decision 8): `/api/system`
// and `/api/providers/pull` don't exist on hosted (404 — also kills the SSRF
// surface of tenant-supplied Ollama base URLs); `/api/providers` returns the
// single anthropic entry WITHOUT probing a localhost Ollama; and
// `/api/providers/test` only knows anthropic + the stored BYO key — it never
// reads the tenant settings row (base URLs) at all.

const requireUser = vi.hoisted(() => vi.fn());
vi.mock("@/lib/user", () => ({ requireUser }));

const getSettings = vi.hoisted(() => vi.fn());
vi.mock("@/lib/settings", () => ({ getSettings }));

const hostedUser = (plan: string, encryptedAnthropicKey: string | null = null) => ({
  ok: true,
  user: {
    id: "u1",
    email: "u@example.com",
    plan,
    encryptedAnthropicKey,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionStatus: null,
  },
});

beforeEach(() => {
  vi.resetModules();
  requireUser.mockReset();
  getSettings.mockReset();
  getSettings.mockImplementation(() => {
    throw new Error("tenant settings must never be read on hosted provider routes");
  });
  vi.stubEnv("SIFT_PROFILE", "hosted");
  vi.stubEnv("ENCRYPTION_SECRET", randomBytes(32).toString("hex"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("hosted /api/system", () => {
  it("404s before auth (the route does not exist on hosted)", async () => {
    const { GET } = await import("../../system/route");
    const res = await GET();
    expect(res.status).toBe(404);
    expect(requireUser).not.toHaveBeenCalled();
  });
});

describe("hosted /api/providers/pull", () => {
  it("404s before auth or any settings read", async () => {
    const { POST } = await import("../pull/route");
    const res = await POST(
      new NextRequest("http://localhost/api/providers/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gemma3:4b" }),
      })
    );
    expect(res.status).toBe(404);
    expect(requireUser).not.toHaveBeenCalled();
    expect(getSettings).not.toHaveBeenCalled();
  });
});

describe("hosted /api/providers", () => {
  it("returns the anthropic-only entry (plan model) without probing Ollama or reading settings", async () => {
    requireUser.mockResolvedValue(hostedUser("free"));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { GET } = await import("../route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      providers: [
        { id: "anthropic", label: "Claude", privacy: "cloud", models: ["claude-haiku-4-5"], configured: true },
      ],
    });
    expect(fetchSpy).not.toHaveBeenCalled(); // no localhost:11434 probe in the lambda hot path
    expect(getSettings).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("reports the BYO model when a stored key is active on a BYO-eligible plan", async () => {
    const { encryptSecret } = await import("@/lib/crypto");
    requireUser.mockResolvedValue(hostedUser("starter", encryptSecret("sk-ant-byo")));
    const { GET } = await import("../route");
    const body = await (await GET()).json();
    expect(body.providers).toEqual([
      { id: "anthropic", label: "Claude", privacy: "cloud", models: ["claude-opus-4-8"], configured: true },
    ]);
  });
});

describe("hosted /api/providers/test", () => {
  function req(provider: string): NextRequest {
    return new NextRequest("http://localhost/api/providers/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    });
  }

  it("refuses every non-anthropic provider without touching settings (no tenant base URLs)", async () => {
    requireUser.mockResolvedValue(hostedUser("pro"));
    const { POST } = await import("../test/route");
    for (const provider of ["ollama", "openai", "gemini", "openai-compatible"]) {
      const res = await POST(req(provider));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/Claude engine/);
    }
    expect(getSettings).not.toHaveBeenCalled();
  });

  it("anthropic without a stored BYO key → 400 (the platform key is never tested for tenants)", async () => {
    requireUser.mockResolvedValue(hostedUser("pro", null));
    const { POST } = await import("../test/route");
    const res = await POST(req("anthropic"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/bring-your-own key/i);
    expect(getSettings).not.toHaveBeenCalled();
  });
});

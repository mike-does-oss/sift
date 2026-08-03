import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mocked so route tests exercise only the request-parsing/validation seam —
// the actual dispatch (resolveProvider + engine call) is covered by
// scaffoldSchema's own tests in src/lib/extraction/__tests__/scaffold.test.ts.
vi.mock("@/lib/extraction/scaffold", async () => {
  const actual = await vi.importActual<typeof import("@/lib/extraction/scaffold")>("@/lib/extraction/scaffold");
  return {
    ...actual,
    scaffoldSchema: vi.fn().mockResolvedValue({ success: true, fields: [{ id: "f1", name: "vendor", type: "text" }], prompt: "p", extractMultiple: false }),
  };
});

import { POST } from "../route";
import { scaffoldSchema } from "@/lib/extraction/scaffold";

function req(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/scaffold", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/scaffold — provider/model override validation (§S3)", () => {
  beforeEach(() => {
    vi.mocked(scaffoldSchema).mockClear();
  });

  it("dispatches with no override when provider is omitted", async () => {
    const res = await POST(req({ description: "extract the vendor and total" }));
    expect(res.status).toBe(200);
    expect(scaffoldSchema).toHaveBeenCalledWith("extract the vendor and total", undefined);
  });

  it("400s on an unknown provider", async () => {
    const res = await POST(req({ description: "extract the vendor", provider: "bogus" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/unknown provider/i);
    expect(scaffoldSchema).not.toHaveBeenCalled();
  });

  it("passes a valid provider through as the override", async () => {
    const res = await POST(req({ description: "extract the vendor", provider: "ollama" }));
    expect(res.status).toBe(200);
    expect(scaffoldSchema).toHaveBeenCalledWith("extract the vendor", { provider: "ollama", model: undefined });
  });

  it("passes provider + model through together", async () => {
    const res = await POST(req({ description: "extract the vendor", provider: "anthropic", model: "claude-opus-4-8" }));
    expect(res.status).toBe(200);
    expect(scaffoldSchema).toHaveBeenCalledWith("extract the vendor", { provider: "anthropic", model: "claude-opus-4-8" });
  });

  it("still validates description first, before looking at provider", async () => {
    const res = await POST(req({ description: "", provider: "bogus" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).not.toMatch(/unknown provider/i);
    expect(scaffoldSchema).not.toHaveBeenCalled();
  });
});

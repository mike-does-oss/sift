import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// §INBOX T1: hosted schedule creation mints the email-in address token;
// the local profile never does (no inbound surface there).

const state = vi.hoisted(() => ({
  requireUser: vi.fn(),
  templateFindFirst: vi.fn(),
  inserts: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/user", () => ({ requireUser: state.requireUser }));

vi.mock("@/db", () => ({
  db: {
    query: { templates: { findFirst: state.templateFindFirst } },
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        state.inserts.push(v);
        return { returning: () => Promise.resolve([{ id: "sch_1", ...v }]) };
      },
    }),
  },
}));

import { POST } from "../route";

function createRequest(): NextRequest {
  return new NextRequest("http://localhost:4215/api/schedules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Nightly", templateId: "tpl_1", cadence: "daily", hourUtc: 3 }),
  });
}

beforeEach(() => {
  state.requireUser.mockReset();
  state.templateFindFirst.mockReset().mockResolvedValue({ id: "tpl_1", userId: "u1" });
  state.inserts.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/schedules — inboundToken", () => {
  it("hosted: generates a 16-char base32 token at create, returned to the caller", async () => {
    vi.stubEnv("SIFT_PROFILE", "hosted");
    state.requireUser.mockResolvedValue({ ok: true, user: { id: "u1", plan: "business", encryptedAnthropicKey: null } });
    const res = await POST(createRequest());
    expect(res.status).toBe(200);
    expect(state.inserts[0].inboundToken).toMatch(/^[a-z2-7]{16}$/);
    expect((await res.json()).schedule.inboundToken).toBe(state.inserts[0].inboundToken);
  });

  it("hosted: two schedules get different tokens", async () => {
    vi.stubEnv("SIFT_PROFILE", "hosted");
    state.requireUser.mockResolvedValue({ ok: true, user: { id: "u1", plan: "business", encryptedAnthropicKey: null } });
    await POST(createRequest());
    await POST(createRequest());
    expect(state.inserts[0].inboundToken).not.toBe(state.inserts[1].inboundToken);
  });

  it("local: inboundToken stays null", async () => {
    vi.stubEnv("SIFT_PROFILE", "");
    state.requireUser.mockResolvedValue({ ok: true, user: { id: "local", plan: "local", encryptedAnthropicKey: null } });
    const res = await POST(createRequest());
    expect(res.status).toBe(200);
    expect(state.inserts[0].inboundToken).toBeNull();
  });
});

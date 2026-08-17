import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// §INBOX T3: server validation for the email-in delivery settings —
// ingestMode enum, boolean toggles, allowedSenders normalization, and the
// ownership-verified datasetId (cross-tenant ids rejected with the same
// answer as nonexistent ones) — plus the inboundDomain GET contract.

const state = vi.hoisted(() => ({
  requireUser: vi.fn(),
  scheduleFindFirst: vi.fn(),
  scheduleFindMany: vi.fn(),
  datasetFindFirst: vi.fn(),
  templateFindFirst: vi.fn(),
  inserts: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/user", () => ({ requireUser: state.requireUser }));

vi.mock("@/db", () => ({
  db: {
    query: {
      schedules: { findFirst: state.scheduleFindFirst, findMany: state.scheduleFindMany },
      datasets: { findFirst: state.datasetFindFirst },
      templates: { findFirst: state.templateFindFirst },
    },
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        state.inserts.push(v);
        return { returning: () => Promise.resolve([{ id: "sch_1", ...v }]) };
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        state.updates.push(v);
        return { where: () => ({ returning: () => Promise.resolve([{ id: "sch_1", ...v }]) }) };
      },
    }),
    select: () => ({
      from: () => ({
        leftJoin: () => ({ where: () => ({ orderBy: () => Promise.resolve([]) }) }),
      }),
    }),
  },
}));

import { PATCH, GET as GET_ONE } from "../[id]/route";
import { GET as GET_LIST, POST } from "../route";

const params = { params: Promise.resolve({ id: "sch_1" }) };

function patchRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:4215/api/schedules/sch_1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function postRequest(extra: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:4215/api/schedules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Nightly", templateId: "tpl_1", cadence: "daily", hourUtc: 3, ...extra }),
  });
}

beforeEach(() => {
  state.requireUser
    .mockReset()
    .mockResolvedValue({ ok: true, user: { id: "u1", plan: "business", encryptedAnthropicKey: null } });
  state.scheduleFindFirst.mockReset().mockResolvedValue({ id: "sch_1", userId: "u1" });
  state.scheduleFindMany.mockReset().mockResolvedValue([]);
  state.datasetFindFirst.mockReset().mockResolvedValue(undefined);
  state.templateFindFirst.mockReset().mockResolvedValue({ id: "tpl_1", userId: "u1" });
  state.inserts.length = 0;
  state.updates.length = 0;
  vi.stubEnv("SIFT_PROFILE", "hosted");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("PATCH /api/schedules/[id] — delivery settings validation", () => {
  it("accepts a full valid delivery patch", async () => {
    state.datasetFindFirst.mockResolvedValue({ id: "ds_1", userId: "u1" });
    const res = await PATCH(
      patchRequest({
        ingestMode: "both",
        processOnArrival: true,
        allowedSenders: "billing@xero.com",
        datasetId: "ds_1",
        notifyEmail: false,
      }),
      params
    );
    expect(res.status).toBe(200);
    expect(state.updates[0]).toMatchObject({
      ingestMode: "both",
      processOnArrival: true,
      allowedSenders: "billing@xero.com",
      datasetId: "ds_1",
      notifyEmail: false,
    });
  });

  it("rejects an unknown ingestMode with 400 and writes nothing", async () => {
    const res = await PATCH(patchRequest({ ingestMode: "everything" }), params);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/ingestMode/);
    expect(state.updates).toHaveLength(0);
  });

  it.each([
    ["processOnArrival", "yes"],
    ["notifyEmail", 1],
  ])("rejects non-boolean %s with 400", async (field, value) => {
    const res = await PATCH(patchRequest({ [field]: value }), params);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(field);
    expect(state.updates).toHaveLength(0);
  });

  it("normalizes allowedSenders: trim, lowercase, leading @ stripped, empties dropped", async () => {
    const res = await PATCH(
      patchRequest({ allowedSenders: "  Billing@Xero.com , @ACME.com ,,  " }),
      params
    );
    expect(res.status).toBe(200);
    expect(state.updates[0].allowedSenders).toBe("billing@xero.com, acme.com");
  });

  it("stores null for an empty allowedSenders string (accept any sender)", async () => {
    const res = await PATCH(patchRequest({ allowedSenders: "   " }), params);
    expect(res.status).toBe(200);
    expect(state.updates[0].allowedSenders).toBeNull();
  });

  it("rejects a non-string allowedSenders with 400", async () => {
    const res = await PATCH(patchRequest({ allowedSenders: 42 }), params);
    expect(res.status).toBe(400);
    expect(state.updates).toHaveLength(0);
  });

  it("accepts a datasetId the user owns", async () => {
    state.datasetFindFirst.mockResolvedValue({ id: "ds_1", userId: "u1" });
    const res = await PATCH(patchRequest({ datasetId: "ds_1" }), params);
    expect(res.status).toBe(200);
    expect(state.updates[0].datasetId).toBe("ds_1");
    expect(state.datasetFindFirst).toHaveBeenCalledTimes(1);
  });

  it("rejects a cross-tenant (or nonexistent) datasetId — same answer, nothing written", async () => {
    // The ownership query is scoped `datasets.userId = user.id`, so a foreign
    // dataset resolves exactly like a missing one: no row.
    state.datasetFindFirst.mockResolvedValue(undefined);
    const res = await PATCH(patchRequest({ datasetId: "ds_of_other_tenant" }), params);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Dataset not found");
    expect(state.updates).toHaveLength(0);
  });

  it("clears datasetId with null", async () => {
    const res = await PATCH(patchRequest({ datasetId: null }), params);
    expect(res.status).toBe(200);
    expect(state.updates[0].datasetId).toBeNull();
    expect(state.datasetFindFirst).not.toHaveBeenCalled();
  });

  it("partial update: PATCHing { active } touches no delivery field", async () => {
    const res = await PATCH(patchRequest({ active: false }), params);
    expect(res.status).toBe(200);
    expect(state.updates[0]).toEqual({ active: false });
  });
});

describe("POST /api/schedules — delivery settings on create", () => {
  it("stores validated delivery settings (senders normalized)", async () => {
    state.datasetFindFirst.mockResolvedValue({ id: "ds_1", userId: "u1" });
    const res = await POST(
      postRequest({
        ingestMode: "email",
        processOnArrival: true,
        allowedSenders: " @Acme.com ",
        datasetId: "ds_1",
        notifyEmail: true,
      })
    );
    expect(res.status).toBe(200);
    expect(state.inserts[0]).toMatchObject({
      ingestMode: "email",
      processOnArrival: true,
      allowedSenders: "acme.com",
      datasetId: "ds_1",
      notifyEmail: true,
    });
  });

  it("rejects a foreign datasetId at create", async () => {
    state.datasetFindFirst.mockResolvedValue(undefined);
    const res = await POST(postRequest({ datasetId: "ds_foreign" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Dataset not found");
    expect(state.inserts).toHaveLength(0);
  });
});

describe("GET inboundDomain contract", () => {
  it("hosted with all RESEND envs: list and detail GET carry the domain", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "whsec_test");
    vi.stubEnv("RESEND_INBOUND_DOMAIN", "in.example.com");
    expect((await (await GET_LIST()).json()).inboundDomain).toBe("in.example.com");
    const detail = await (await GET_ONE(patchRequest({}), params)).json();
    expect(detail.inboundDomain).toBe("in.example.com");
  });

  it("hosted with RESEND envs missing: inboundDomain is null (UI shows the unconfigured line)", async () => {
    vi.stubEnv("RESEND_INBOUND_DOMAIN", "in.example.com"); // domain alone isn't enough
    expect((await (await GET_LIST()).json()).inboundDomain).toBeNull();
  });

  it("local profile: inboundDomain is null even with RESEND envs set", async () => {
    vi.stubEnv("SIFT_PROFILE", "");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "whsec_test");
    vi.stubEnv("RESEND_INBOUND_DOMAIN", "in.example.com");
    state.requireUser.mockResolvedValue({ ok: true, user: { id: "local", plan: "local", encryptedAnthropicKey: null } });
    expect((await (await GET_LIST()).json()).inboundDomain).toBeNull();
  });
});

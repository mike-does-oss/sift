import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

// §SaaS-1 T5 billing routes. Hosted-only surface (local profile → 404 before
// anything else runs), and the webhook: signature-authorized, and THE SOLE
// WRITER of users.plan — these tests pin exactly what each of its three
// events writes and where the row match happens.

const state = vi.hoisted(() => ({
  updates: [] as Array<{ values: Record<string, unknown>; where: unknown }>,
  constructEvent: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: (where: unknown) => {
          state.updates.push({ values, where });
          return Promise.resolve();
        },
      }),
    }),
  },
}));

vi.mock("@/lib/stripe", () => ({
  stripe: { webhooks: { constructEvent: state.constructEvent } },
}));

function whereParams(where: unknown): unknown[] {
  return new PgDialect().sqlToQuery(where as SQL).params;
}

function post(url: string, body = "{}", headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost:4215${url}`, { method: "POST", body, headers });
}

beforeEach(() => {
  vi.resetModules();
  state.updates.length = 0;
  state.constructEvent.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("local profile → 404 (billing surface does not exist there)", () => {
  it("checkout, portal, webhook", async () => {
    vi.stubEnv("SIFT_PROFILE", "");
    const checkout = await import("@/app/api/stripe/checkout/route");
    const portal = await import("@/app/api/stripe/portal/route");
    const webhook = await import("@/app/api/stripe/webhook/route");
    expect((await checkout.POST(post("/api/stripe/checkout"))).status).toBe(404);
    expect((await portal.POST(post("/api/stripe/portal"))).status).toBe(404);
    expect((await webhook.POST(post("/api/stripe/webhook"))).status).toBe(404);
    expect(state.constructEvent).not.toHaveBeenCalled();
  });

  it("byo-key PUT/GET/DELETE", async () => {
    vi.stubEnv("SIFT_PROFILE", "");
    const route = await import("@/app/api/settings/byo-key/route");
    expect((await route.PUT(post("/api/settings/byo-key"))).status).toBe(404);
    expect((await route.GET()).status).toBe(404);
    expect((await route.DELETE()).status).toBe(404);
  });

  it("usage returns the unmetered local shape", async () => {
    vi.stubEnv("SIFT_PROFILE", "");
    const route = await import("@/app/api/usage/route");
    const res = await route.GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ plan: "local", unlimited: true });
  });
});

describe("webhook (hosted)", () => {
  beforeEach(() => {
    vi.stubEnv("SIFT_PROFILE", "hosted");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
    vi.stubEnv("STRIPE_PRICE_STARTER", "price_starter");
    vi.stubEnv("STRIPE_PRICE_PRO", "price_pro");
    vi.stubEnv("STRIPE_PRICE_BUSINESS", "price_business");
  });

  async function deliver(event: unknown) {
    state.constructEvent.mockReturnValue(event);
    const { POST } = await import("@/app/api/stripe/webhook/route");
    return POST(post("/api/stripe/webhook", "raw-payload", { "stripe-signature": "sig" }));
  }

  it("400 on a bad signature, and writes nothing", async () => {
    state.constructEvent.mockImplementation(() => {
      throw new Error("bad signature");
    });
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const res = await POST(post("/api/stripe/webhook", "raw-payload", { "stripe-signature": "nope" }));
    expect(res.status).toBe(400);
    expect(state.updates).toEqual([]);
  });

  it("verifies the raw body against STRIPE_WEBHOOK_SECRET", async () => {
    await deliver({ type: "unhandled.event", data: { object: {} } });
    expect(state.constructEvent).toHaveBeenCalledWith("raw-payload", "sig", "whsec_test");
  });

  it("checkout.session.completed links the Stripe customer to the user by client_reference_id", async () => {
    const res = await deliver({
      type: "checkout.session.completed",
      data: { object: { client_reference_id: "user-1", customer: "cus_1" } },
    });
    expect(res.status).toBe(200);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].values).toEqual({ stripeCustomerId: "cus_1" });
    expect(whereParams(state.updates[0].where)).toEqual(["user-1"]);
  });

  it("subscription.created|updated sets the plan from the price id when active, matched by stripeCustomerId", async () => {
    for (const [type, status] of [
      ["customer.subscription.created", "active"],
      ["customer.subscription.updated", "trialing"],
    ] as const) {
      state.updates.length = 0;
      const res = await deliver({
        type,
        data: {
          object: {
            id: "sub_1",
            status,
            customer: "cus_1",
            items: { data: [{ price: { id: "price_pro" } }] },
          },
        },
      });
      expect(res.status).toBe(200);
      expect(state.updates).toHaveLength(1);
      expect(state.updates[0].values).toEqual({
        plan: "pro",
        stripeSubscriptionId: "sub_1",
        subscriptionStatus: status,
      });
      expect(whereParams(state.updates[0].where)).toEqual(["cus_1"]);
    }
  });

  it("subscription.updated reverts to free when inactive or the price is unmapped", async () => {
    await deliver({
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1", status: "past_due", customer: "cus_1", items: { data: [{ price: { id: "price_pro" } }] } } },
    });
    expect(state.updates[0].values).toMatchObject({ plan: "free", subscriptionStatus: "past_due" });

    state.updates.length = 0;
    await deliver({
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1", status: "active", customer: "cus_1", items: { data: [{ price: { id: "price_rogue" } }] } } },
    });
    expect(state.updates[0].values).toMatchObject({ plan: "free" });
  });

  it("subscription.deleted reverts to free and clears the subscription", async () => {
    const res = await deliver({
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_1", customer: "cus_1" } },
    });
    expect(res.status).toBe(200);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].values).toEqual({
      plan: "free",
      stripeSubscriptionId: null,
      subscriptionStatus: "canceled",
    });
    expect(whereParams(state.updates[0].where)).toEqual(["cus_1"]);
  });

  it("acknowledges unhandled event types without writing", async () => {
    const res = await deliver({ type: "invoice.paid", data: { object: {} } });
    expect(res.status).toBe(200);
    expect(state.updates).toEqual([]);
  });
});

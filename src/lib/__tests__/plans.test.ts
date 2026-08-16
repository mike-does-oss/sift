import { afterEach, describe, it, expect } from "vitest";
import { vi } from "vitest";
import {
  PLANS,
  BYO_KEY_MODEL,
  planFromPriceId,
  priceIdForPlan,
  remainingQuota,
  planFeatures,
  cheapestByoKeyPlan,
} from "../plans";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("PLANS", () => {
  it("defines the four tiers with spec limits", () => {
    expect(PLANS.free.monthlyExtractions).toBe(10);
    expect(PLANS.starter.monthlyExtractions).toBe(200);
    expect(PLANS.pro.monthlyExtractions).toBe(1000);
    expect(PLANS.business.monthlyExtractions).toBe(5000);
    expect(PLANS.free.priceMonthly).toBe(0);
    expect(PLANS.starter.priceMonthly).toBe(19);
    expect(PLANS.pro.priceMonthly).toBe(49);
    expect(PLANS.business.priceMonthly).toBe(149);
    expect(PLANS.free.byoKey).toBe(false);
    expect(PLANS.starter.byoKey).toBe(true);
    expect(PLANS.free.batch).toBe(false);
    expect(PLANS.starter.batch).toBe(false);
    expect(PLANS.pro.batchLimit).toBe(25);
    expect(PLANS.business.batchLimit).toBe(100);
    expect(PLANS.business.schedules).toBe(true);
    expect(PLANS.pro.schedules).toBe(false);
  });

  it("tiers models by plan: free/starter on haiku, pro/business on sonnet", () => {
    expect(PLANS.free.model).toBe("claude-haiku-4-5");
    expect(PLANS.starter.model).toBe("claude-haiku-4-5");
    expect(PLANS.pro.model).toBe("claude-sonnet-5");
    expect(PLANS.business.model).toBe("claude-sonnet-5");
  });

  it("pins the BYO-key model to opus regardless of plan tiering", () => {
    expect(BYO_KEY_MODEL).toBe("claude-opus-4-8");
  });
});

describe("planFromPriceId", () => {
  it("maps env price ids to plans", () => {
    vi.stubEnv("STRIPE_PRICE_STARTER", "price_starter_test");
    vi.stubEnv("STRIPE_PRICE_PRO", "price_pro_test");
    vi.stubEnv("STRIPE_PRICE_BUSINESS", "price_business_test");
    expect(planFromPriceId("price_starter_test")).toBe("starter");
    expect(planFromPriceId("price_pro_test")).toBe("pro");
    expect(planFromPriceId("price_business_test")).toBe("business");
    expect(planFromPriceId("price_unknown")).toBeNull();
    expect(planFromPriceId(null)).toBeNull();
    expect(planFromPriceId(undefined)).toBeNull();
  });

  it("never maps to a plan when the env vars are unset (no undefined === undefined hole)", () => {
    vi.stubEnv("STRIPE_PRICE_STARTER", "");
    vi.stubEnv("STRIPE_PRICE_PRO", "");
    vi.stubEnv("STRIPE_PRICE_BUSINESS", "");
    delete process.env.STRIPE_PRICE_STARTER;
    delete process.env.STRIPE_PRICE_PRO;
    delete process.env.STRIPE_PRICE_BUSINESS;
    expect(planFromPriceId("price_anything")).toBeNull();
  });
});

describe("priceIdForPlan", () => {
  it("returns the env price id and throws when missing", () => {
    vi.stubEnv("STRIPE_PRICE_PRO", "price_pro_test");
    expect(priceIdForPlan("pro")).toBe("price_pro_test");
    vi.stubEnv("STRIPE_PRICE_BUSINESS", "");
    delete process.env.STRIPE_PRICE_BUSINESS;
    expect(() => priceIdForPlan("business")).toThrow(/STRIPE_PRICE_BUSINESS/);
  });
});

describe("remainingQuota", () => {
  it("computes remaining and floors at zero", () => {
    expect(remainingQuota("free", 3)).toBe(7);
    expect(remainingQuota("free", 10)).toBe(0);
    expect(remainingQuota("free", 12)).toBe(0);
    expect(remainingQuota("business", 0)).toBe(5000);
  });
});

describe("planFeatures", () => {
  it("derives bullets from the config, never hardcoded numbers", () => {
    expect(planFeatures("free")).toEqual(["10 extractions / month"]);
    expect(planFeatures("business")).toEqual([
      "5,000 extractions / month",
      "Bring your own API key",
      "Batch uploads — up to 100 files at once",
      "Scheduled, recurring extractions",
    ]);
  });
});

describe("cheapestByoKeyPlan", () => {
  it("is starter (the cheapest tier with byoKey)", () => {
    expect(cheapestByoKeyPlan()).toBe("starter");
  });
});

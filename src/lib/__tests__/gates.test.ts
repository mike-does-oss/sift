import { describe, it, expect } from "vitest";
import { byoKeyActive, quotaGate, batchGate, scheduleGate, byoKeyGate, type GateUser } from "../gates";
import { PLANS, type Plan } from "../plans";

const user = (plan: Plan | "local", key: string | null = null): GateUser => ({
  plan,
  encryptedAnthropicKey: key,
});

describe("gate matrix: plan × operation → expected code", () => {
  // [plan, batchDenialCode|null, scheduleDenialCode|null, byoKeyDenialCode|null]
  const matrix: Array<[Plan, string | null, string | null, string | null]> = [
    ["free", "UPGRADE_REQUIRED", "UPGRADE_REQUIRED", "UPGRADE_REQUIRED"],
    ["starter", "UPGRADE_REQUIRED", "UPGRADE_REQUIRED", null],
    ["pro", null, "UPGRADE_REQUIRED", null],
    ["business", null, null, null],
  ];

  it.each(matrix)("%s: batch=%s schedules=%s byoKey=%s", (plan, batchCode, scheduleCode, byoCode) => {
    const b = batchGate(plan, 1);
    expect(b?.code ?? null).toBe(batchCode);
    if (b) expect(b.status).toBe(403);

    const s = scheduleGate(plan);
    expect(s?.code ?? null).toBe(scheduleCode);
    if (s) expect(s.status).toBe(403);

    const k = byoKeyGate(plan);
    expect(k?.code ?? null).toBe(byoCode);
    if (k) expect(k.status).toBe(403);
  });

  it("extract quota: 402 QUOTA_EXCEEDED exactly at each plan's PLANS limit", () => {
    for (const plan of ["free", "starter", "pro", "business"] as const) {
      const limit = PLANS[plan].monthlyExtractions;
      expect(quotaGate(plan, limit - 1, 1)).toBeNull();
      const denial = quotaGate(plan, limit, 1)!;
      expect(denial.status).toBe(402);
      expect(denial.code).toBe("QUOTA_EXCEEDED");
    }
  });

  it("batch quota: needs the whole batch's worth of remaining quota", () => {
    expect(quotaGate("pro", 990, 10)).toBeNull();
    const denial = quotaGate("pro", 991, 10)!;
    expect(denial.status).toBe(402);
    expect(denial.code).toBe("QUOTA_EXCEEDED");
    expect(denial.error).toContain("needs 10 extractions");
    expect(denial.error).toContain("9 left");
  });

  it("batch size caps come from PLANS.batchLimit", () => {
    expect(batchGate("pro", PLANS.pro.batchLimit)).toBeNull();
    const over = batchGate("pro", PLANS.pro.batchLimit + 1)!;
    expect(over.status).toBe(400);
    expect(over.code).toBeUndefined();
    expect(over.error).toContain(`${PLANS.pro.batchLimit}`);
    expect(batchGate("business", PLANS.business.batchLimit)).toBeNull();
    expect(batchGate("business", PLANS.business.batchLimit + 1)?.status).toBe(400);
  });

  it("the synthetic local plan bypasses EVERY gate", () => {
    expect(quotaGate("local", Number.MAX_SAFE_INTEGER, 1)).toBeNull();
    expect(batchGate("local", 10_000)).toBeNull();
    expect(scheduleGate("local")).toBeNull();
    expect(byoKeyGate("local")).toBeNull();
  });
});

describe("usedByoKey stamping decision table (byoKeyActive)", () => {
  // [plan, hasStoredKey, expected stamp]
  const table: Array<[Plan | "local", boolean, boolean]> = [
    ["local", false, false],
    ["local", true, false], // no key vault on local, ever
    ["free", false, false],
    ["free", true, false], // stored key but plan without byoKey → platform, metered
    ["starter", false, false],
    ["starter", true, true],
    ["pro", true, true],
    ["business", true, true],
    ["business", false, false],
  ];

  it.each(table)("plan=%s key=%s → usedByoKey=%s", (plan, hasKey, expected) => {
    expect(byoKeyActive(user(plan, hasKey ? "aa:bb:cc" : null))).toBe(expected);
  });
});

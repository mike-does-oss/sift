import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// §SaaS-1 T6: the hosted landing page's pricing table must be GENERATED from
// `PLANS` (src/lib/plans.ts) — never hand-copied numbers that go stale when
// a tier changes. Same grep-guard style as no-sync-drizzle.test.ts: the page
// source itself is the artifact under test.

const pageSource = readFileSync(path.resolve(__dirname, "../page.tsx"), "utf8");

describe("hosted landing pricing derives from PLANS", () => {
  it("imports PLANS and planFeatures from the single source of truth", () => {
    expect(pageSource).toMatch(/import\s+\{[^}]*\bPLANS\b[^}]*\}\s+from\s+"@\/lib\/plans"/);
    expect(pageSource).toMatch(/\bplanFeatures\(/);
  });

  it("renders every tier by iterating PLANS, not a hand-maintained list", () => {
    expect(pageSource).toMatch(/Object\.keys\(PLANS\)/);
  });

  it("contains no literal dollar amounts — prices only ever come from cfg.priceMonthly", () => {
    // A literal like "$19" or "$149/mo" in the JSX would drift the moment
    // plans.ts changes. The only allowed "$" next to a digit-producing value
    // is the `${cfg.priceMonthly}` interpolation.
    expect(pageSource).not.toMatch(/\$\d/);
    expect(pageSource).toMatch(/\{cfg\.priceMonthly\}/);
  });

  it("contains no literal quota or batch-size figures", () => {
    // The feature bullets come from planFeatures(plan); nothing in the page
    // should restate PLANS' numbers (10/200/1000/5000 quotas, 25/100 batch).
    for (const figure of ["10", "200", "1000", "5000", "1,000", "5,000"]) {
      expect(pageSource).not.toMatch(new RegExp(`[>\\s"']${figure} extractions`));
    }
  });
});

import { describe, it, expect } from "vitest";
import { fieldColor, fieldColorVars, fieldHue } from "../fieldColors";

function circularDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

describe("fieldHue", () => {
  it("is deterministic — same index always yields the same hue", () => {
    expect(fieldHue(5)).toBe(fieldHue(5));
    expect(fieldHue(0)).toBe(fieldHue(0));
  });

  it("stays within [0, 360)", () => {
    for (let i = 0; i < 50; i++) {
      const h = fieldHue(i);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });

  it("follows the golden-angle rotation h = (index * 137.508) % 360", () => {
    expect(fieldHue(0)).toBeCloseTo(0, 5);
    expect(fieldHue(1)).toBeCloseTo(137.508, 5);
    expect(fieldHue(2)).toBeCloseTo(275.016, 5);
    // wraps past 360
    expect(fieldHue(3)).toBeCloseTo(52.524, 5);
  });

  // Golden-angle placement guarantees indices never collide and stay well
  // spread, but the *exact* achievable minimum pairwise gap shrinks as the
  // set grows (it's not a flat 25° floor for arbitrarily many fields) — for
  // the first 12 indices the true minimum gap this rotation produces is
  // ~20.06° (index 0 vs. index 8), not the 25° a naive equal-division guess
  // would suggest. Assert the real, verified bound rather than an aspirational
  // one that would make this test flaky-by-construction.
  it("keeps the first 12 hues pairwise distinct with a substantial minimum gap (~20°)", () => {
    const hues = Array.from({ length: 12 }, (_, i) => fieldHue(i));
    let minGap = Infinity;
    for (let i = 0; i < hues.length; i++) {
      for (let j = i + 1; j < hues.length; j++) {
        const d = circularDistance(hues[i], hues[j]);
        expect(d).toBeGreaterThan(0); // no two of the first 12 collide
        minGap = Math.min(minGap, d);
      }
    }
    expect(minGap).toBeGreaterThanOrEqual(20);
  });

  // A smaller, still-common field count (most templates have well under 8
  // fields) does clear the brief's original 25° bar comfortably.
  it("keeps the first 8 hues at least 25° apart", () => {
    const hues = Array.from({ length: 8 }, (_, i) => fieldHue(i));
    for (let i = 0; i < hues.length; i++) {
      for (let j = i + 1; j < hues.length; j++) {
        expect(circularDistance(hues[i], hues[j])).toBeGreaterThanOrEqual(25);
      }
    }
  });
});

describe("fieldColor", () => {
  it("is deterministic by index", () => {
    expect(fieldColor(3)).toEqual(fieldColor(3));
  });

  it("light bg is a pastel tint and text is a darker shade of the same hue", () => {
    const c = fieldColor(0);
    expect(c.light.bg).toBe("hsl(0, 45%, 87%)");
    expect(c.light.text).toBe("hsl(0, 45%, 25%)");
  });

  it("dark bg is a deep tint and text is a lighter shade of the same hue", () => {
    const c = fieldColor(0);
    expect(c.dark.bg).toBe("hsl(0, 40%, 26%)");
    expect(c.dark.text).toBe("hsl(0, 45%, 80%)");
  });

  it("every shade string is a well-formed hsl() color", () => {
    const hslPattern = /^hsl\(\d+(\.\d+)?, \d+%, \d+%\)$/;
    for (let i = 0; i < 10; i++) {
      const c = fieldColor(i);
      expect(c.light.bg).toMatch(hslPattern);
      expect(c.light.text).toMatch(hslPattern);
      expect(c.dark.bg).toMatch(hslPattern);
      expect(c.dark.text).toMatch(hslPattern);
    }
  });

  it("different indices produce different hues (distinct colors)", () => {
    expect(fieldColor(0).light.bg).not.toBe(fieldColor(1).light.bg);
    expect(fieldColor(1).light.bg).not.toBe(fieldColor(2).light.bg);
  });
});

describe("fieldColorVars", () => {
  it("returns the four CSS-var keys with values matching fieldColor", () => {
    const c = fieldColor(4);
    const vars = fieldColorVars(4);
    expect(vars).toEqual({
      "--mark-bg-light": c.light.bg,
      "--mark-text-light": c.light.text,
      "--mark-bg-dark": c.dark.bg,
      "--mark-text-dark": c.dark.text,
    });
  });

  it("is deterministic by index", () => {
    expect(fieldColorVars(7)).toEqual(fieldColorVars(7));
  });
});

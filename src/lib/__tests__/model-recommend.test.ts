import { describe, it, expect } from "vitest";
import { recommendModels, type SystemInfo } from "../model-recommend";

const appleSilicon = (totalRamGB: number): SystemInfo => ({ totalRamGB, arch: "arm64", platform: "darwin" });
const windows = (totalRamGB: number): SystemInfo => ({ totalRamGB, arch: "x64", platform: "win32" });

function recommended(recs: ReturnType<typeof recommendModels>) {
  const matches = recs.filter((r) => r.recommended);
  expect(matches).toHaveLength(1);
  return matches[0];
}

describe("recommendModels", () => {
  it("recommends gemma3:1b under 8 GB", () => {
    const recs = recommendModels(appleSilicon(4));
    expect(recommended(recs).model).toBe("gemma3:1b");
  });

  it("recommends gemma3:4b for 8-15 GB", () => {
    const recs = recommendModels(appleSilicon(8));
    expect(recommended(recs).model).toBe("gemma3:4b");
    expect(recommended(recs).vision).toBe(true);
  });

  it("recommends gemma3:4b at the top of its tier (15 GB)", () => {
    const recs = recommendModels(appleSilicon(15));
    expect(recommended(recs).model).toBe("gemma3:4b");
  });

  it("recommends gemma3:12b for 16-31 GB", () => {
    const recs = recommendModels(appleSilicon(16));
    expect(recommended(recs).model).toBe("gemma3:12b");
  });

  it("recommends gemma3:12b at the top of its tier (31 GB)", () => {
    const recs = recommendModels(appleSilicon(31));
    expect(recommended(recs).model).toBe("gemma3:12b");
  });

  it("recommends gemma3:27b at 32 GB and above", () => {
    const recs = recommendModels(appleSilicon(32));
    expect(recommended(recs).model).toBe("gemma3:27b");
  });

  it("recommends gemma3:27b for a high-memory machine (64 GB)", () => {
    const recs = recommendModels(appleSilicon(64));
    expect(recommended(recs).model).toBe("gemma3:27b");
  });

  it("returns exactly one recommended:true entry in every tier", () => {
    for (const ram of [2, 4, 8, 12, 16, 24, 32, 128]) {
      recommended(recommendModels(appleSilicon(ram)));
    }
  });

  it("mentions the actual RAM figure in the recommended reason", () => {
    expect(recommended(recommendModels(appleSilicon(4))).reason).toContain("4 GB");
    expect(recommended(recommendModels(appleSilicon(8))).reason).toContain("8 GB");
    expect(recommended(recommendModels(appleSilicon(16))).reason).toContain("16 GB");
  });

  it("adds a caveat to the <8GB alt for low memory", () => {
    const recs = recommendModels(appleSilicon(4));
    const alt = recs.find((r) => r.model === "gemma3:4b");
    expect(alt?.caveat).toContain("4 GB");
  });

  it("omits the GPU caveat on Apple Silicon for gemma3:12b and gemma3:27b", () => {
    const midTier = recommendModels(appleSilicon(16));
    expect(midTier.find((r) => r.model === "gemma3:12b")?.caveat).toBeUndefined();

    const topTier = recommendModels(appleSilicon(64));
    expect(topTier.find((r) => r.model === "gemma3:27b")?.caveat).toBeUndefined();
    expect(topTier.find((r) => r.model === "gemma3:12b")?.caveat).toBeUndefined();
  });

  it("adds a GPU caveat off Apple Silicon for gemma3:12b and gemma3:27b", () => {
    const midTier = recommendModels(windows(16));
    expect(midTier.find((r) => r.model === "gemma3:12b")?.caveat).toMatch(/GPU/);

    const topTier = recommendModels(windows(64));
    expect(topTier.find((r) => r.model === "gemma3:27b")?.caveat).toMatch(/GPU/);
    expect(topTier.find((r) => r.model === "gemma3:12b")?.caveat).toMatch(/GPU/);
  });

  it("never adds a GPU caveat to gemma3:1b or gemma3:4b regardless of platform", () => {
    const recs = recommendModels(windows(64));
    expect(recs.find((r) => r.model === "gemma3:4b")?.caveat).toBeUndefined();
    expect(recs.find((r) => r.model === "gemma3:1b")?.caveat).toBeUndefined();
  });

  it("does not apply the GPU caveat on an Intel Mac (darwin/x64)", () => {
    const recs = recommendModels({ totalRamGB: 32, arch: "x64", platform: "darwin" });
    expect(recs.find((r) => r.model === "gemma3:27b")?.caveat).toMatch(/GPU/);
  });
});

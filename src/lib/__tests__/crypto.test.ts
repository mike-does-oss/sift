import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "crypto";
import { encryptSecret, decryptSecret, maskKey } from "../crypto";

beforeAll(() => {
  process.env.ENCRYPTION_SECRET = randomBytes(32).toString("hex");
});

describe("crypto", () => {
  it("round-trips a secret", () => {
    const enc = encryptSecret("sk-ant-api03-hello");
    expect(enc).not.toContain("sk-ant");
    expect(decryptSecret(enc)).toBe("sk-ant-api03-hello");
  });

  it("produces different ciphertext per call (random IV)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("throws on tampered payload", () => {
    const enc = encryptSecret("secret");
    const parts = enc.split(":");
    parts[2] = parts[2].replace(/^../, "00");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });

  it("throws on a tampered auth tag", () => {
    const enc = encryptSecret("secret");
    const parts = enc.split(":");
    parts[1] = parts[1].replace(/^../, parts[1].startsWith("00") ? "11" : "00");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });

  it("rejects a malformed ENCRYPTION_SECRET", () => {
    const prev = process.env.ENCRYPTION_SECRET;
    process.env.ENCRYPTION_SECRET = "too-short";
    expect(() => encryptSecret("x")).toThrow(/64 hex chars/);
    process.env.ENCRYPTION_SECRET = prev;
  });

  it("masks keys to last 4", () => {
    expect(maskKey("sk-ant-api03-xyzw1234")).toBe("sk-ant-…1234");
    expect(maskKey("something-else-9999")).toBe("some…9999");
  });
});

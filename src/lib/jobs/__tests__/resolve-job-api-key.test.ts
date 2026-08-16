import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "crypto";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { encryptSecret } from "@/lib/crypto";

// §SaaS-1 T5 — per-job BYO resolution (donor extracto jobs.ts semantics):
// the decision comes from the JOB ROW's frozen `usedByoKey` stamp AND the
// owner still having a stored key. Never from the owner's current plan, and
// never on the local profile.

const getDbUserById = vi.hoisted(() => vi.fn());
vi.mock("@/lib/user", () => ({ getDbUserById }));

const job = (usedByoKey: boolean) => ({ id: "job-1", userId: "user-1", usedByoKey });

beforeEach(() => {
  vi.resetModules();
  getDbUserById.mockReset();
  vi.stubEnv("ENCRYPTION_SECRET", randomBytes(32).toString("hex"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("resolveJobApiKey", () => {
  it("hosted + stamped BYO + owner still has a key → decrypts it", async () => {
    vi.stubEnv("SIFT_PROFILE", "hosted");
    vi.stubEnv("DATABASE_URL", "");
    getDbUserById.mockResolvedValue({ plan: "starter", encryptedAnthropicKey: encryptSecret("sk-ant-byo-9999") });
    const { resolveJobApiKey } = await import("../core");
    expect(await resolveJobApiKey(job(true))).toBe("sk-ant-byo-9999");
    expect(getDbUserById).toHaveBeenCalledWith("user-1");
  });

  it("hosted + stamped BYO but the owner deleted their key → undefined (platform fallback)", async () => {
    vi.stubEnv("SIFT_PROFILE", "hosted");
    vi.stubEnv("DATABASE_URL", "");
    getDbUserById.mockResolvedValue({ plan: "starter", encryptedAnthropicKey: null });
    const { resolveJobApiKey } = await import("../core");
    expect(await resolveJobApiKey(job(true))).toBeUndefined();
  });

  it("hosted + NOT stamped BYO → undefined without even looking up the owner (the stamp is frozen)", async () => {
    vi.stubEnv("SIFT_PROFILE", "hosted");
    vi.stubEnv("DATABASE_URL", "");
    const { resolveJobApiKey } = await import("../core");
    expect(await resolveJobApiKey(job(false))).toBeUndefined();
    expect(getDbUserById).not.toHaveBeenCalled();
  });

  it("local profile → always undefined, no user lookup", async () => {
    vi.stubEnv("SIFT_PROFILE", "");
    // Importing core on local eagerly opens the sqlite db — scratch dir only.
    vi.stubEnv("SIFT_DATA_DIR", mkdtempSync(path.join(tmpdir(), "sift-t5-byo-")));
    const { resolveJobApiKey } = await import("../core");
    expect(await resolveJobApiKey(job(true))).toBeUndefined();
    expect(getDbUserById).not.toHaveBeenCalled();
  });
});

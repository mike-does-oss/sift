import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "crypto";
import { encryptSecret } from "@/lib/crypto";

// §SaaS-1 T5 hosted model/key resolution: provider is ALWAYS anthropic, the
// model tier is a billing decision (PLANS[plan].model, BYO → opus), and the
// key is the user's decrypted BYO key or the platform ANTHROPIC_API_KEY.

const getDbUserById = vi.hoisted(() => vi.fn());
vi.mock("@/lib/user", () => ({ getDbUserById }));

// §T6 SSRF closure: the hosted branch must never read the tenant settings
// row — `settings.provider`, `ollamaBaseUrl`, `compatBaseUrl` are all
// attacker-controlled per-tenant values there. This mock makes any settings
// read on the hosted path an immediate test failure.
const getSettings = vi.hoisted(() => vi.fn());
vi.mock("@/lib/settings", () => ({ getSettings }));

type UserRow = { plan: "free" | "starter" | "pro" | "business"; encryptedAnthropicKey: string | null };
const row = (plan: UserRow["plan"], key: string | null = null): UserRow => ({ plan, encryptedAnthropicKey: key });

async function resolve(override?: { provider: string; model?: string; apiKey?: string }) {
  const { resolveProvider } = await import("../provider-resolution");
  return resolveProvider(override as Parameters<typeof resolveProvider>[0], "user-1");
}

beforeEach(() => {
  vi.resetModules();
  getDbUserById.mockReset();
  getSettings.mockReset();
  getSettings.mockImplementation(() => {
    throw new Error("tenant settings must never be read on the hosted provider path");
  });
  vi.stubEnv("SIFT_PROFILE", "hosted");
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "platform-key");
  vi.stubEnv("ENCRYPTION_SECRET", randomBytes(32).toString("hex"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("hosted plan→model tiering (platform key)", () => {
  it.each([
    ["free", "claude-haiku-4-5"],
    ["starter", "claude-haiku-4-5"],
    ["pro", "claude-sonnet-5"],
    ["business", "claude-sonnet-5"],
  ] as const)("%s → %s", async (plan, model) => {
    getDbUserById.mockResolvedValue(row(plan));
    expect(await resolve()).toEqual({ ok: true, provider: "anthropic", model, apiKey: "platform-key" });
  });
});

describe("hosted BYO key", () => {
  it("a stored key on a BYO-eligible plan → opus on the decrypted key", async () => {
    getDbUserById.mockResolvedValue(row("starter", encryptSecret("sk-ant-byo-1234")));
    expect(await resolve()).toEqual({ ok: true, provider: "anthropic", model: "claude-opus-4-8", apiKey: "sk-ant-byo-1234" });
  });

  it("a stored key on a plan WITHOUT byoKey is ignored → plan model on the platform key", async () => {
    getDbUserById.mockResolvedValue(row("free", encryptSecret("sk-ant-byo-1234")));
    expect(await resolve()).toEqual({ ok: true, provider: "anthropic", model: "claude-haiku-4-5", apiKey: "platform-key" });
  });
});

describe("hosted override handling", () => {
  it("ignores an untrusted model override — the tier is a billing decision", async () => {
    getDbUserById.mockResolvedValue(row("free"));
    const resolved = await resolve({ provider: "anthropic", model: "claude-opus-4-8" });
    expect(resolved).toEqual({ ok: true, provider: "anthropic", model: "claude-haiku-4-5", apiKey: "platform-key" });
  });

  it("rejects an arbitrary model string ('gpt-4o') — only the plan model can run", async () => {
    getDbUserById.mockResolvedValue(row("pro"));
    const resolved = await resolve({ provider: "anthropic", model: "gpt-4o" });
    expect(resolved).toEqual({ ok: true, provider: "anthropic", model: "claude-sonnet-5", apiKey: "platform-key" });
  });

  it("refuses non-anthropic providers", async () => {
    const resolved = await resolve({ provider: "ollama" });
    expect(resolved.ok).toBe(false);
    expect(getDbUserById).not.toHaveBeenCalled();
  });

  it("ignores settings.provider=ollama entirely — the settings row is never even read", async () => {
    // getSettings is mocked to throw; if the hosted branch consulted the
    // tenant settings (provider choice, ollamaBaseUrl, compatBaseUrl) this
    // would reject instead of resolving to anthropic on the platform key.
    getDbUserById.mockResolvedValue(row("free"));
    const resolved = await resolve();
    expect(resolved).toEqual({ ok: true, provider: "anthropic", model: "claude-haiku-4-5", apiKey: "platform-key" });
    expect(getSettings).not.toHaveBeenCalled();
  });

  it("honors a trusted internal override (apiKey-carrying, from the jobs worker) verbatim", async () => {
    const resolved = await resolve({ provider: "anthropic", model: "claude-opus-4-8", apiKey: "sk-ant-frozen" });
    expect(resolved).toEqual({ ok: true, provider: "anthropic", model: "claude-opus-4-8", apiKey: "sk-ant-frozen" });
    expect(getDbUserById).not.toHaveBeenCalled();
  });
});

describe("hosted failure modes", () => {
  it("throws when no BYO key and no platform env key exist — no silent SDK env fallback", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    getDbUserById.mockResolvedValue(row("free"));
    await expect(resolve()).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it("throws without a userId (a missing tenant scope is a bug, not a fallback)", async () => {
    const { resolveProvider } = await import("../provider-resolution");
    await expect(resolveProvider()).rejects.toThrow(/userId/);
  });

  it("resolves not-ok for an unknown user", async () => {
    getDbUserById.mockResolvedValue(undefined);
    const resolved = await resolve();
    expect(resolved.ok).toBe(false);
  });
});

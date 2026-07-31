import { describe, it, expect, vi, afterEach } from "vitest";
import { getProviderInfo } from "../providers-info";
import { DEFAULT_SETTINGS } from "../settings";

describe("getProviderInfo", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists installed ollama models when the /api/tags call succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ models: [{ name: "gemma3:4b" }, { name: "llama3.2" }] }),
      })
    );

    const providers = await getProviderInfo(DEFAULT_SETTINGS);
    const ollama = providers.find((p) => p.id === "ollama")!;
    expect(ollama.configured).toBe(true);
    expect(ollama.privacy).toBe("local");
    expect(ollama.models).toEqual(["gemma3:4b", "llama3.2"]);
    expect(ollama.note).toBeUndefined();
  });

  it("reports ollama as configured with no models and a note when the call fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")));

    const providers = await getProviderInfo(DEFAULT_SETTINGS);
    const ollama = providers.find((p) => p.id === "ollama")!;
    expect(ollama.configured).toBe(true);
    expect(ollama.models).toEqual([]);
    expect(ollama.note).toBe("Ollama not running");
  });

  it("reports ollama as configured with no models and a note on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const providers = await getProviderInfo(DEFAULT_SETTINGS);
    const ollama = providers.find((p) => p.id === "ollama")!;
    expect(ollama.models).toEqual([]);
    expect(ollama.note).toBe("Ollama not running");
  });

  it("marks anthropic/openai unconfigured when no key is set, but still offers model suggestions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }) }));

    const providers = await getProviderInfo(DEFAULT_SETTINGS);
    const anthropic = providers.find((p) => p.id === "anthropic")!;
    const openai = providers.find((p) => p.id === "openai")!;

    expect(anthropic.configured).toBe(false);
    expect(anthropic.privacy).toBe("cloud");
    expect(anthropic.models).toContain(DEFAULT_SETTINGS.anthropicModel);
    expect(anthropic.models.length).toBeGreaterThan(1);

    expect(openai.configured).toBe(false);
    expect(openai.models).toContain(DEFAULT_SETTINGS.openaiModel);
  });

  it("marks anthropic/openai configured when a key is present, and never echoes the key", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }) }));

    const providers = await getProviderInfo({
      ...DEFAULT_SETTINGS,
      anthropicApiKey: "sk-ant-secret",
      openaiApiKey: "sk-oai-secret",
    });
    const anthropic = providers.find((p) => p.id === "anthropic")!;
    const openai = providers.find((p) => p.id === "openai")!;

    expect(anthropic.configured).toBe(true);
    expect(openai.configured).toBe(true);
    const serialized = JSON.stringify(providers);
    expect(serialized).not.toContain("sk-ant-secret");
    expect(serialized).not.toContain("sk-oai-secret");
  });

  it("returns exactly the three current providers (ollama, anthropic, openai)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }) }));
    const providers = await getProviderInfo(DEFAULT_SETTINGS);
    expect(providers.map((p) => p.id).sort()).toEqual(["anthropic", "ollama", "openai"]);
  });
});

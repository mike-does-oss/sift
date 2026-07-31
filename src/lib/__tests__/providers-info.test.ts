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

  it("returns exactly the five current providers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }) }));
    const providers = await getProviderInfo(DEFAULT_SETTINGS);
    expect(providers.map((p) => p.id).sort()).toEqual([
      "anthropic",
      "gemini",
      "ollama",
      "openai",
      "openai-compatible",
    ]);
  });

  it("marks gemini unconfigured with no key, configured with one, and never echoes the key", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }) }));

    const unconfigured = await getProviderInfo(DEFAULT_SETTINGS);
    const geminiUnconfigured = unconfigured.find((p) => p.id === "gemini")!;
    expect(geminiUnconfigured.configured).toBe(false);
    expect(geminiUnconfigured.privacy).toBe("cloud");
    expect(geminiUnconfigured.models).toEqual(["gemini-2.0-flash", "gemini-1.5-pro"]);

    const configured = await getProviderInfo({ ...DEFAULT_SETTINGS, geminiApiKey: "gm-secret" });
    const geminiConfigured = configured.find((p) => p.id === "gemini")!;
    expect(geminiConfigured.configured).toBe(true);
    expect(JSON.stringify(configured)).not.toContain("gm-secret");
  });

  it("dedups the configured gemini model against the suggestions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }) }));
    const providers = await getProviderInfo({ ...DEFAULT_SETTINGS, geminiModel: "gemini-2.0-flash" });
    const gemini = providers.find((p) => p.id === "gemini")!;
    expect(gemini.models).toEqual(["gemini-2.0-flash", "gemini-1.5-pro"]);
  });

  it("marks openai-compatible unconfigured until both baseUrl and model are set, with a Settings-worded note", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }) }));

    const none = await getProviderInfo(DEFAULT_SETTINGS);
    const compatNone = none.find((p) => p.id === "openai-compatible")!;
    expect(compatNone.configured).toBe(false);
    expect(compatNone.models).toEqual([]);
    expect(compatNone.note).toBe("Set a base URL in Settings");

    const baseOnly = await getProviderInfo({ ...DEFAULT_SETTINGS, compatBaseUrl: "http://localhost:11434/v1" });
    const compatBaseOnly = baseOnly.find((p) => p.id === "openai-compatible")!;
    expect(compatBaseOnly.configured).toBe(false);
    expect(compatBaseOnly.note).toBe("Set a model in Settings");

    const both = await getProviderInfo({
      ...DEFAULT_SETTINGS,
      compatBaseUrl: "http://localhost:11434/v1",
      compatModel: "gemma3:4b",
    });
    const compatBoth = both.find((p) => p.id === "openai-compatible")!;
    expect(compatBoth.configured).toBe(true);
    expect(compatBoth.models).toEqual(["gemma3:4b"]);
    expect(compatBoth.note).toBeUndefined();
    expect(compatBoth.label).toBe("OpenAI-compatible");
    expect(compatBoth.privacy).toBe("cloud");
  });
});

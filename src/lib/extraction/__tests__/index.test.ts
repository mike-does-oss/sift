import { describe, it, expect, vi, beforeEach } from "vitest";

const getSettingsMock = vi.fn();
vi.mock("@/lib/settings", () => ({ getSettings: async () => getSettingsMock() }));

const extractWithClaudeMock = vi.fn();
const extractWithOpenAIMock = vi.fn();
const extractWithOllamaMock = vi.fn();
const extractWithOpenAICompatibleMock = vi.fn();
vi.mock("../claude", () => ({ extractWithClaude: (...args: unknown[]) => extractWithClaudeMock(...args) }));
vi.mock("../openai", () => ({ extractWithOpenAI: (...args: unknown[]) => extractWithOpenAIMock(...args) }));
vi.mock("../ollama", () => ({ extractWithOllama: (...args: unknown[]) => extractWithOllamaMock(...args) }));
vi.mock("../openaiCompatible", () => ({
  extractWithOpenAICompatible: (...args: unknown[]) => extractWithOpenAICompatibleMock(...args),
}));

import { runExtraction } from "../index";

const BASE_SETTINGS = {
  provider: "ollama" as const,
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "gemma3:4b",
  anthropicApiKey: "ant-key",
  anthropicModel: "claude-sonnet-5",
  openaiApiKey: "oai-key",
  openaiModel: "gpt-4o",
  geminiApiKey: "gm-key",
  geminiModel: "gemini-2.0-flash",
  compatBaseUrl: "http://localhost:11434/v1",
  compatApiKey: "compat-key",
  compatModel: "gemma3:4b",
};

const baseInput = {
  source: { kind: "text" as const, text: "document body" },
  filename: "doc.txt",
  fields: [],
  prompt: "",
  extractMultiple: false,
};

describe("runExtraction — no override", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettingsMock.mockReturnValue(BASE_SETTINGS);
    extractWithOllamaMock.mockResolvedValue({ success: true, data: {} });
    extractWithClaudeMock.mockResolvedValue({ success: true, data: {} });
    extractWithOpenAIMock.mockResolvedValue({ success: true, data: {} });
  });

  it("dispatches to the settings-configured provider (ollama) with settings model/baseUrl", async () => {
    const result = await runExtraction(baseInput);
    expect(extractWithOllamaMock).toHaveBeenCalledTimes(1);
    expect(extractWithOllamaMock.mock.calls[0][0]).toMatchObject({ model: "gemma3:4b", baseUrl: "http://localhost:11434" });
    expect(extractWithClaudeMock).not.toHaveBeenCalled();
    expect(extractWithOpenAIMock).not.toHaveBeenCalled();
    expect(result.provider).toBe("ollama");
    expect(result.model).toBe("gemma3:4b");
  });

  it("dispatches to anthropic when settings.provider is anthropic, passing the settings key and model", async () => {
    getSettingsMock.mockReturnValue({ ...BASE_SETTINGS, provider: "anthropic" });
    const result = await runExtraction(baseInput);
    expect(extractWithClaudeMock).toHaveBeenCalledTimes(1);
    expect(extractWithClaudeMock.mock.calls[0][0]).toMatchObject({ apiKey: "ant-key", model: "claude-sonnet-5" });
    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("claude-sonnet-5");
  });

  it("passes `grounded` straight through to the engine when the caller sets it (§T2.5)", async () => {
    const result = await runExtraction({ ...baseInput, grounded: true });
    expect(extractWithOllamaMock.mock.calls[0][0]).toMatchObject({ grounded: true });
    expect(result.provider).toBe("ollama");
  });

  it("leaves `grounded` unset when the caller never sets it — jobs/batches never ground (§T2.5)", async () => {
    await runExtraction(baseInput);
    expect(extractWithOllamaMock.mock.calls[0][0].grounded).toBeUndefined();
  });
});

describe("runExtraction — override", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettingsMock.mockReturnValue(BASE_SETTINGS);
    extractWithOllamaMock.mockResolvedValue({ success: true, data: {} });
    extractWithClaudeMock.mockResolvedValue({ success: true, data: {} });
    extractWithOpenAIMock.mockResolvedValue({ success: true, data: {} });
  });

  it("overrides the configured provider: settings=ollama, override=anthropic runs claude with settings' anthropic key/model", async () => {
    const result = await runExtraction(baseInput, { provider: "anthropic" });
    expect(extractWithClaudeMock).toHaveBeenCalledTimes(1);
    expect(extractWithOllamaMock).not.toHaveBeenCalled();
    expect(extractWithClaudeMock.mock.calls[0][0]).toMatchObject({ apiKey: "ant-key", model: "claude-sonnet-5" });
    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("claude-sonnet-5");
  });

  it("overrides the configured provider: settings=anthropic, override=ollama runs ollama with settings' ollama baseUrl/model", async () => {
    getSettingsMock.mockReturnValue({ ...BASE_SETTINGS, provider: "anthropic" });
    const result = await runExtraction(baseInput, { provider: "ollama" });
    expect(extractWithOllamaMock).toHaveBeenCalledTimes(1);
    expect(extractWithClaudeMock).not.toHaveBeenCalled();
    expect(extractWithOllamaMock.mock.calls[0][0]).toMatchObject({ model: "gemma3:4b", baseUrl: "http://localhost:11434" });
    expect(result.provider).toBe("ollama");
    expect(result.model).toBe("gemma3:4b");
  });

  it("an override model wins over that provider's settings model", async () => {
    const result = await runExtraction(baseInput, { provider: "openai", model: "gpt-4o-mini" });
    expect(extractWithOpenAIMock).toHaveBeenCalledTimes(1);
    expect(extractWithOpenAIMock.mock.calls[0][0]).toMatchObject({ apiKey: "oai-key", model: "gpt-4o-mini" });
    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-4o-mini");
  });

  it("an override with no model falls back to that provider's settings model", async () => {
    const result = await runExtraction(baseInput, { provider: "openai" });
    expect(extractWithOpenAIMock.mock.calls[0][0]).toMatchObject({ model: "gpt-4o" });
    expect(result.model).toBe("gpt-4o");
  });
});

describe("runExtraction — gemini", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettingsMock.mockReturnValue(BASE_SETTINGS);
    extractWithOpenAICompatibleMock.mockResolvedValue({ success: true, data: {} });
  });

  it("dispatches gemini to the compat engine, pinned to Google's OpenAI-compatible base URL, with the gemini key/model", async () => {
    const result = await runExtraction(baseInput, { provider: "gemini" });
    expect(extractWithOpenAICompatibleMock).toHaveBeenCalledTimes(1);
    expect(extractWithOpenAICompatibleMock.mock.calls[0][0]).toMatchObject({
      apiKey: "gm-key",
      model: "gemini-2.0-flash",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    });
    expect(result.provider).toBe("gemini");
    expect(result.model).toBe("gemini-2.0-flash");
  });

  it("an override model wins over the settings gemini model", async () => {
    const result = await runExtraction(baseInput, { provider: "gemini", model: "gemini-1.5-pro" });
    expect(extractWithOpenAICompatibleMock.mock.calls[0][0]).toMatchObject({ model: "gemini-1.5-pro" });
    expect(result.model).toBe("gemini-1.5-pro");
  });

  it("returns a friendly error and never calls the engine when no gemini key is set", async () => {
    getSettingsMock.mockReturnValue({ ...BASE_SETTINGS, geminiApiKey: "" });
    const result = await runExtraction(baseInput, { provider: "gemini" });
    expect(extractWithOpenAICompatibleMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toBe("Gemini API key not set — add it in Settings");
  });
});

describe("runExtraction — openai-compatible", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettingsMock.mockReturnValue(BASE_SETTINGS);
    extractWithOpenAICompatibleMock.mockResolvedValue({ success: true, data: {} });
  });

  it("dispatches openai-compatible to the compat engine with the configured baseUrl/model, key optional", async () => {
    const result = await runExtraction(baseInput, { provider: "openai-compatible" });
    expect(extractWithOpenAICompatibleMock).toHaveBeenCalledTimes(1);
    expect(extractWithOpenAICompatibleMock.mock.calls[0][0]).toMatchObject({
      apiKey: "compat-key",
      model: "gemma3:4b",
      baseUrl: "http://localhost:11434/v1",
    });
    expect(result.provider).toBe("openai-compatible");
    expect(result.model).toBe("gemma3:4b");
  });

  it("passes apiKey as undefined (not an empty string) when compatApiKey is unset", async () => {
    getSettingsMock.mockReturnValue({ ...BASE_SETTINGS, compatApiKey: "" });
    await runExtraction(baseInput, { provider: "openai-compatible" });
    expect(extractWithOpenAICompatibleMock.mock.calls[0][0].apiKey).toBeUndefined();
  });

  it("an override model wins over the settings compat model", async () => {
    const result = await runExtraction(baseInput, { provider: "openai-compatible", model: "llama3" });
    expect(extractWithOpenAICompatibleMock.mock.calls[0][0]).toMatchObject({ model: "llama3" });
    expect(result.model).toBe("llama3");
  });

  it("returns a friendly error and never calls the engine when no base URL is set", async () => {
    getSettingsMock.mockReturnValue({ ...BASE_SETTINGS, compatBaseUrl: "" });
    const result = await runExtraction(baseInput, { provider: "openai-compatible" });
    expect(extractWithOpenAICompatibleMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toBe("Base URL not set — add it in Settings");
  });

  it("returns a friendly error and never calls the engine when no model is set", async () => {
    getSettingsMock.mockReturnValue({ ...BASE_SETTINGS, compatModel: "" });
    const result = await runExtraction(baseInput, { provider: "openai-compatible" });
    expect(extractWithOpenAICompatibleMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toBe("Model not set — add it in Settings");
  });
});

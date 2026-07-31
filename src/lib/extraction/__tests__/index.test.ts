import { describe, it, expect, vi, beforeEach } from "vitest";

const getSettingsMock = vi.fn();
vi.mock("@/lib/settings", () => ({ getSettings: () => getSettingsMock() }));

const extractWithClaudeMock = vi.fn();
const extractWithOpenAIMock = vi.fn();
const extractWithOllamaMock = vi.fn();
vi.mock("../claude", () => ({ extractWithClaude: (...args: unknown[]) => extractWithClaudeMock(...args) }));
vi.mock("../openai", () => ({ extractWithOpenAI: (...args: unknown[]) => extractWithOpenAIMock(...args) }));
vi.mock("../ollama", () => ({ extractWithOllama: (...args: unknown[]) => extractWithOllamaMock(...args) }));

import { runExtraction } from "../index";

const BASE_SETTINGS = {
  provider: "ollama" as const,
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "gemma3:4b",
  anthropicApiKey: "ant-key",
  anthropicModel: "claude-sonnet-5",
  openaiApiKey: "oai-key",
  openaiModel: "gpt-4o",
};

const baseInput = { pdfBase64: "AAAA", filename: "doc.pdf", fields: [], prompt: "", extractMultiple: false };

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

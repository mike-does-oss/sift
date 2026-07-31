import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { settings } from "@/db/schema";
import {
  DEFAULT_SETTINGS,
  getSettings,
  maskedSettings,
  updateSettings,
} from "../settings";

describe("settings", () => {
  beforeEach(() => {
    db.delete(settings).run();
  });

  it("returns defaults when no rows are set", () => {
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(getSettings().provider).toBe("ollama");
  });

  it("persists an update and merges it over the defaults", () => {
    const updated = updateSettings({ provider: "anthropic" });
    expect(updated.provider).toBe("anthropic");
    expect(updated.ollamaModel).toBe(DEFAULT_SETTINGS.ollamaModel);

    // Re-fetch independently to prove it was persisted, not just returned.
    const reloaded = getSettings();
    expect(reloaded.provider).toBe("anthropic");
    expect(reloaded.ollamaModel).toBe(DEFAULT_SETTINGS.ollamaModel);
  });

  it("merges multiple updates across separate calls", () => {
    updateSettings({ ollamaBaseUrl: "http://example:1234" });
    updateSettings({ ollamaModel: "llama3" });
    const reloaded = getSettings();
    expect(reloaded.ollamaBaseUrl).toBe("http://example:1234");
    expect(reloaded.ollamaModel).toBe("llama3");
  });

  it("throws on an invalid provider value", () => {
    expect(() =>
      updateSettings({ provider: "bogus" as unknown as "ollama" })
    ).toThrow();
  });

  it("throws on an unknown settings key", () => {
    expect(() =>
      updateSettings({ notAKey: "x" } as unknown as Partial<typeof DEFAULT_SETTINGS>)
    ).toThrow();
  });

  it("masks api keys down to a last-4 sentinel, and empty as empty", () => {
    expect(maskedSettings().anthropicApiKey).toBe("");
    expect(maskedSettings().openaiApiKey).toBe("");

    updateSettings({ anthropicApiKey: "sk-ant-test1234" });
    expect(maskedSettings().anthropicApiKey).toBe("…1234");
    // The masked view must never leak the full key.
    expect(maskedSettings().anthropicApiKey).not.toContain("sk-ant-test1234");

    updateSettings({ openaiApiKey: "sk-openai-abcd5678" });
    expect(maskedSettings().openaiApiKey).toBe("…5678");
  });

  it("clears an api key when patched with an empty string", () => {
    updateSettings({ anthropicApiKey: "sk-ant-test1234" });
    expect(maskedSettings().anthropicApiKey).toBe("…1234");

    updateSettings({ anthropicApiKey: "" });
    expect(maskedSettings().anthropicApiKey).toBe("");
    expect(getSettings().anthropicApiKey).toBe("");
  });

  it("rejects an empty string for non-key settings, but still clears api keys", () => {
    expect(() => updateSettings({ ollamaModel: "" })).toThrow('Setting "ollamaModel" cannot be empty.');
    expect(getSettings().ollamaModel).toBe(DEFAULT_SETTINGS.ollamaModel);

    updateSettings({ anthropicApiKey: "sk-ant-test1234" });
    expect(() => updateSettings({ anthropicApiKey: "" })).not.toThrow();
    expect(getSettings().anthropicApiKey).toBe("");
  });

  it("defaults the new gemini/openai-compatible keys", () => {
    const defaults = getSettings();
    expect(defaults.geminiApiKey).toBe("");
    expect(defaults.geminiModel).toBe("gemini-2.0-flash");
    expect(defaults.compatBaseUrl).toBe("");
    expect(defaults.compatApiKey).toBe("");
    expect(defaults.compatModel).toBe("");
  });

  it("accepts gemini and openai-compatible as valid providers", () => {
    expect(updateSettings({ provider: "gemini" }).provider).toBe("gemini");
    expect(updateSettings({ provider: "openai-compatible" }).provider).toBe("openai-compatible");
  });

  it("masks the gemini and compat api keys, and clears them on empty-string patch", () => {
    updateSettings({ geminiApiKey: "gm-secret-1234" });
    expect(maskedSettings().geminiApiKey).toBe("…1234");
    expect(maskedSettings().geminiApiKey).not.toContain("gm-secret-1234");
    updateSettings({ geminiApiKey: "" });
    expect(getSettings().geminiApiKey).toBe("");

    updateSettings({ compatApiKey: "compat-secret-5678" });
    expect(maskedSettings().compatApiKey).toBe("…5678");
    updateSettings({ compatApiKey: "" });
    expect(getSettings().compatApiKey).toBe("");
  });

  it("allows compatBaseUrl and compatModel to be cleared to empty string (provider is simply unconfigured)", () => {
    updateSettings({ compatBaseUrl: "http://localhost:11434/v1", compatModel: "gemma3:4b" });
    expect(getSettings().compatBaseUrl).toBe("http://localhost:11434/v1");
    expect(getSettings().compatModel).toBe("gemma3:4b");

    expect(() => updateSettings({ compatBaseUrl: "" })).not.toThrow();
    expect(() => updateSettings({ compatModel: "" })).not.toThrow();
    expect(getSettings().compatBaseUrl).toBe("");
    expect(getSettings().compatModel).toBe("");
  });

  it("rejects non-string values instead of coercing them", () => {
    expect(() =>
      updateSettings({ anthropicApiKey: null } as unknown as Partial<typeof DEFAULT_SETTINGS>)
    ).toThrow();
    // Rejected patch must not have partially persisted.
    expect(getSettings().anthropicApiKey).toBe("");
    expect(maskedSettings().anthropicApiKey).toBe("");

    expect(() =>
      updateSettings({ ollamaModel: 123 } as unknown as Partial<typeof DEFAULT_SETTINGS>)
    ).toThrow();
    expect(getSettings().ollamaModel).toBe(DEFAULT_SETTINGS.ollamaModel);
  });
});

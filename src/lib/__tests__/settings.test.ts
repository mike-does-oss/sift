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
  beforeEach(async () => {
    await db.delete(settings);
  });

  it("returns defaults when no rows are set", async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
    expect((await getSettings()).provider).toBe("ollama");
  });

  it("persists an update and merges it over the defaults", async () => {
    const updated = await updateSettings({ provider: "anthropic" });
    expect(updated.provider).toBe("anthropic");
    expect(updated.ollamaModel).toBe(DEFAULT_SETTINGS.ollamaModel);

    // Re-fetch independently to prove it was persisted, not just returned.
    const reloaded = await getSettings();
    expect(reloaded.provider).toBe("anthropic");
    expect(reloaded.ollamaModel).toBe(DEFAULT_SETTINGS.ollamaModel);
  });

  it("merges multiple updates across separate calls", async () => {
    await updateSettings({ ollamaBaseUrl: "http://example:1234" });
    await updateSettings({ ollamaModel: "llama3" });
    const reloaded = await getSettings();
    expect(reloaded.ollamaBaseUrl).toBe("http://example:1234");
    expect(reloaded.ollamaModel).toBe("llama3");
  });

  it("throws on an invalid provider value", async () => {
    await expect(
      updateSettings({ provider: "bogus" as unknown as "ollama" })
    ).rejects.toThrow();
  });

  it("throws on an unknown settings key", async () => {
    await expect(
      updateSettings({ notAKey: "x" } as unknown as Partial<typeof DEFAULT_SETTINGS>)
    ).rejects.toThrow();
  });

  it("masks api keys down to a last-4 sentinel, and empty as empty", async () => {
    expect((await maskedSettings()).anthropicApiKey).toBe("");
    expect((await maskedSettings()).openaiApiKey).toBe("");

    await updateSettings({ anthropicApiKey: "sk-ant-test1234" });
    expect((await maskedSettings()).anthropicApiKey).toBe("…1234");
    // The masked view must never leak the full key.
    expect((await maskedSettings()).anthropicApiKey).not.toContain("sk-ant-test1234");

    await updateSettings({ openaiApiKey: "sk-openai-abcd5678" });
    expect((await maskedSettings()).openaiApiKey).toBe("…5678");
  });

  it("clears an api key when patched with an empty string", async () => {
    await updateSettings({ anthropicApiKey: "sk-ant-test1234" });
    expect((await maskedSettings()).anthropicApiKey).toBe("…1234");

    await updateSettings({ anthropicApiKey: "" });
    expect((await maskedSettings()).anthropicApiKey).toBe("");
    expect((await getSettings()).anthropicApiKey).toBe("");
  });

  it("rejects an empty string for non-key settings, but still clears api keys", async () => {
    await expect(updateSettings({ ollamaModel: "" })).rejects.toThrow('Setting "ollamaModel" cannot be empty.');
    expect((await getSettings()).ollamaModel).toBe(DEFAULT_SETTINGS.ollamaModel);

    await updateSettings({ anthropicApiKey: "sk-ant-test1234" });
    await expect(updateSettings({ anthropicApiKey: "" })).resolves.not.toThrow();
    expect((await getSettings()).anthropicApiKey).toBe("");
  });

  it("defaults the new gemini/openai-compatible keys", async () => {
    const defaults = await getSettings();
    expect(defaults.geminiApiKey).toBe("");
    expect(defaults.geminiModel).toBe("gemini-2.0-flash");
    expect(defaults.compatBaseUrl).toBe("");
    expect(defaults.compatApiKey).toBe("");
    expect(defaults.compatModel).toBe("");
  });

  it("accepts gemini and openai-compatible as valid providers", async () => {
    expect((await updateSettings({ provider: "gemini" })).provider).toBe("gemini");
    expect((await updateSettings({ provider: "openai-compatible" })).provider).toBe("openai-compatible");
  });

  it("masks the gemini and compat api keys, and clears them on empty-string patch", async () => {
    await updateSettings({ geminiApiKey: "gm-secret-1234" });
    expect((await maskedSettings()).geminiApiKey).toBe("…1234");
    expect((await maskedSettings()).geminiApiKey).not.toContain("gm-secret-1234");
    await updateSettings({ geminiApiKey: "" });
    expect((await getSettings()).geminiApiKey).toBe("");

    await updateSettings({ compatApiKey: "compat-secret-5678" });
    expect((await maskedSettings()).compatApiKey).toBe("…5678");
    await updateSettings({ compatApiKey: "" });
    expect((await getSettings()).compatApiKey).toBe("");
  });

  it("allows compatBaseUrl and compatModel to be cleared to empty string (provider is simply unconfigured)", async () => {
    await updateSettings({ compatBaseUrl: "http://localhost:11434/v1", compatModel: "gemma3:4b" });
    expect((await getSettings()).compatBaseUrl).toBe("http://localhost:11434/v1");
    expect((await getSettings()).compatModel).toBe("gemma3:4b");

    await expect(updateSettings({ compatBaseUrl: "" })).resolves.not.toThrow();
    await expect(updateSettings({ compatModel: "" })).resolves.not.toThrow();
    expect((await getSettings()).compatBaseUrl).toBe("");
    expect((await getSettings()).compatModel).toBe("");
  });

  it("rejects non-string values instead of coercing them", async () => {
    await expect(
      updateSettings({ anthropicApiKey: null } as unknown as Partial<typeof DEFAULT_SETTINGS>)
    ).rejects.toThrow();
    // Rejected patch must not have partially persisted.
    expect((await getSettings()).anthropicApiKey).toBe("");
    expect((await maskedSettings()).anthropicApiKey).toBe("");

    await expect(
      updateSettings({ ollamaModel: 123 } as unknown as Partial<typeof DEFAULT_SETTINGS>)
    ).rejects.toThrow();
    expect((await getSettings()).ollamaModel).toBe(DEFAULT_SETTINGS.ollamaModel);
  });
});

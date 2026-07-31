import { getSettings } from "@/lib/settings";
import type { ProviderId } from "@/lib/api";
import { extractWithClaude } from "./claude";
import { extractWithOpenAI } from "./openai";
import { extractWithOllama } from "./ollama";
import { extractWithOpenAICompatible } from "./openaiCompatible";
import type { ExtractionInput, ExtractionOutput } from "./types";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";

export type { ExtractionInput, ExtractionOutput } from "./types";
export type RunResult = ExtractionOutput & { provider: string; model: string };

/**
 * Per-request override: which provider/model to run instead of the
 * configured default. `provider` selects both the engine and whose settings
 * key/base URL to use (e.g. picking "ollama" always uses the settings
 * ollamaBaseUrl, regardless of the configured default provider); `model`
 * overrides that provider's configured model. Omitting the override leaves
 * behavior identical to reading straight from settings.
 */
export interface ExtractionOverride {
  provider: ProviderId;
  model?: string;
}

export async function runExtraction(
  input: Omit<ExtractionInput, "apiKey" | "model">,
  override?: ExtractionOverride
): Promise<RunResult> {
  const s = getSettings();
  const provider = override?.provider ?? s.provider;

  switch (provider) {
    case "anthropic": {
      const model = override?.model || s.anthropicModel;
      return { ...(await extractWithClaude({ ...input, apiKey: s.anthropicApiKey || undefined, model })), provider: "anthropic", model };
    }
    case "openai": {
      const model = override?.model || s.openaiModel;
      return { ...(await extractWithOpenAI({ ...input, apiKey: s.openaiApiKey || undefined, model })), provider: "openai", model };
    }
    case "gemini": {
      const model = override?.model || s.geminiModel;
      if (!s.geminiApiKey) {
        return { success: false, error: "Gemini API key not set — add it in Settings", provider: "gemini", model };
      }
      return {
        ...(await extractWithOpenAICompatible({ ...input, apiKey: s.geminiApiKey, model, baseUrl: GEMINI_BASE_URL })),
        provider: "gemini",
        model,
      };
    }
    case "openai-compatible": {
      const model = override?.model || s.compatModel;
      if (!s.compatBaseUrl) {
        return { success: false, error: "Base URL not set — add it in Settings", provider: "openai-compatible", model };
      }
      if (!model) {
        return { success: false, error: "Model not set — add it in Settings", provider: "openai-compatible", model: "" };
      }
      return {
        ...(await extractWithOpenAICompatible({ ...input, apiKey: s.compatApiKey || undefined, model, baseUrl: s.compatBaseUrl })),
        provider: "openai-compatible",
        model,
      };
    }
    case "ollama": {
      const model = override?.model || s.ollamaModel;
      return { ...(await extractWithOllama({ ...input, model, baseUrl: s.ollamaBaseUrl })), provider: "ollama", model };
    }
    default: {
      // Exhaustiveness check: adding a sixth ProviderId without a case above
      // is now a compile error here, not a silent fall-through to Ollama.
      const _exhaustive: never = provider;
      throw new Error(`Unknown provider: ${_exhaustive}`);
    }
  }
}

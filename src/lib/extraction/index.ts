import { getSettings } from "@/lib/settings";
import type { ProviderId } from "@/lib/api";
import { extractWithClaude } from "./claude";
import { extractWithOpenAI } from "./openai";
import { extractWithOllama } from "./ollama";
import type { ExtractionInput, ExtractionOutput } from "./types";

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

  if (provider === "anthropic") {
    const model = override?.model || s.anthropicModel;
    return { ...(await extractWithClaude({ ...input, apiKey: s.anthropicApiKey || undefined, model })), provider: "anthropic", model };
  }
  if (provider === "openai") {
    const model = override?.model || s.openaiModel;
    return { ...(await extractWithOpenAI({ ...input, apiKey: s.openaiApiKey || undefined, model })), provider: "openai", model };
  }
  const model = override?.model || s.ollamaModel;
  return { ...(await extractWithOllama({ ...input, model, baseUrl: s.ollamaBaseUrl })), provider: "ollama", model };
}

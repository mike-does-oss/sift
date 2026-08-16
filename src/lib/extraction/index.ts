import { resolveProvider } from "./provider-resolution";
import { extractWithClaude } from "./claude";
import { extractWithOpenAI } from "./openai";
import { extractWithOllama } from "./ollama";
import { extractWithOpenAICompatible } from "./openaiCompatible";
import type { ExtractionInput, ExtractionOutput } from "./types";

export type { ExtractionInput, ExtractionOutput } from "./types";
export type { ExtractionOverride } from "./provider-resolution";
export type RunResult = ExtractionOutput & { provider: string; model: string };

import type { ExtractionOverride } from "./provider-resolution";

export async function runExtraction(
  input: Omit<ExtractionInput, "apiKey" | "model">,
  override?: ExtractionOverride
): Promise<RunResult> {
  const resolved = await resolveProvider(override);
  if (!resolved.ok) {
    return { success: false, error: resolved.error, provider: resolved.provider, model: resolved.model };
  }

  switch (resolved.provider) {
    case "anthropic":
      return {
        ...(await extractWithClaude({ ...input, apiKey: resolved.apiKey, model: resolved.model })),
        provider: "anthropic",
        model: resolved.model,
      };
    case "openai":
      return {
        ...(await extractWithOpenAI({ ...input, apiKey: resolved.apiKey, model: resolved.model })),
        provider: "openai",
        model: resolved.model,
      };
    case "gemini":
    case "openai-compatible":
      return {
        ...(await extractWithOpenAICompatible({
          ...input,
          apiKey: resolved.apiKey,
          model: resolved.model,
          baseUrl: resolved.baseUrl,
        })),
        provider: resolved.provider,
        model: resolved.model,
      };
    case "ollama":
      return {
        ...(await extractWithOllama({ ...input, model: resolved.model, baseUrl: resolved.baseUrl })),
        provider: "ollama",
        model: resolved.model,
      };
  }
}

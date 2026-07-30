import { getSettings } from "@/lib/settings";
import { extractWithClaude } from "./claude";
import { extractWithOpenAI } from "./openai";
import { extractWithOllama } from "./ollama";
import type { ExtractionInput, ExtractionOutput } from "./types";

export type { ExtractionInput, ExtractionOutput } from "./types";
export type RunResult = ExtractionOutput & { provider: string; model: string };

export async function runExtraction(
  input: Omit<ExtractionInput, "apiKey" | "model">
): Promise<RunResult> {
  const s = getSettings();
  if (s.provider === "anthropic") {
    const model = s.anthropicModel;
    return { ...(await extractWithClaude({ ...input, apiKey: s.anthropicApiKey || undefined, model })), provider: "anthropic", model };
  }
  if (s.provider === "openai") {
    const model = s.openaiModel;
    return { ...(await extractWithOpenAI({ ...input, apiKey: s.openaiApiKey || undefined, model })), provider: "openai", model };
  }
  const model = s.ollamaModel;
  return { ...(await extractWithOllama({ ...input, model, baseUrl: s.ollamaBaseUrl })), provider: "ollama", model };
}

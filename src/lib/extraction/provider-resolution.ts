import { getSettings } from "@/lib/settings";
import type { ProviderId } from "@/lib/api";

export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";

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

/**
 * The provider/model/credentials a request should run against, resolved from
 * settings + an optional per-request override — the same rules `runExtraction`
 * has always applied (§T2.6: pulled out so `scaffoldSchema` can dispatch
 * through the identical resolution instead of duplicating the switch).
 * `gemini` resolves onto the openai-compatible engine, pinned to Google's
 * OpenAI-compatible base URL, since it's the same wire protocol.
 */
export type ProviderResolution =
  | { ok: true; provider: "anthropic"; model: string; apiKey?: string }
  | { ok: true; provider: "openai"; model: string; apiKey?: string }
  | { ok: true; provider: "gemini" | "openai-compatible"; model: string; apiKey?: string; baseUrl: string }
  | { ok: true; provider: "ollama"; model: string; baseUrl: string }
  | { ok: false; provider: ProviderId; model: string; error: string };

export async function resolveProvider(override?: ExtractionOverride, userId?: string): Promise<ProviderResolution> {
  // `userId` scopes which tenant's settings drive the resolution (§SaaS-1):
  // request paths pass `user.id` from `requireUser()`, the jobs worker passes
  // the job row's `userId`. Omitted = local profile's "local" user
  // (`getSettings` refuses an unscoped read on hosted).
  const s = await getSettings(userId);
  const provider = override?.provider ?? s.provider;

  switch (provider) {
    case "anthropic": {
      const model = override?.model || s.anthropicModel;
      return { ok: true, provider: "anthropic", model, apiKey: s.anthropicApiKey || undefined };
    }
    case "openai": {
      const model = override?.model || s.openaiModel;
      return { ok: true, provider: "openai", model, apiKey: s.openaiApiKey || undefined };
    }
    case "gemini": {
      const model = override?.model || s.geminiModel;
      if (!s.geminiApiKey) {
        return { ok: false, provider: "gemini", model, error: "Gemini API key not set — add it in Settings" };
      }
      return { ok: true, provider: "gemini", model, apiKey: s.geminiApiKey, baseUrl: GEMINI_BASE_URL };
    }
    case "openai-compatible": {
      const model = override?.model || s.compatModel;
      if (!s.compatBaseUrl) {
        return { ok: false, provider: "openai-compatible", model, error: "Base URL not set — add it in Settings" };
      }
      if (!model) {
        return { ok: false, provider: "openai-compatible", model: "", error: "Model not set — add it in Settings" };
      }
      return { ok: true, provider: "openai-compatible", model, apiKey: s.compatApiKey || undefined, baseUrl: s.compatBaseUrl };
    }
    case "ollama": {
      const model = override?.model || s.ollamaModel;
      return { ok: true, provider: "ollama", model, baseUrl: s.ollamaBaseUrl };
    }
    default: {
      // Exhaustiveness check: adding a sixth ProviderId without a case above
      // is now a compile error here, not a silent fall-through to Ollama.
      const _exhaustive: never = provider;
      throw new Error(`Unknown provider: ${_exhaustive}`);
    }
  }
}

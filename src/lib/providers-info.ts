import type { SiftSettings } from "@/lib/settings";
import type { ProviderId, ProviderInfo } from "@/lib/api";

const OLLAMA_TAGS_TIMEOUT_MS = 2000;

const LABELS: Record<ProviderId, string> = {
  ollama: "Ollama (local)",
  anthropic: "Anthropic",
  openai: "OpenAI",
};

// Suggested models offered alongside whatever the user has configured, so the
// per-request picker (Task 5) has something reasonable to choose from even
// before Settings has been touched.
const CLOUD_SUGGESTIONS: Record<"anthropic" | "openai", string[]> = {
  anthropic: ["claude-sonnet-5", "claude-haiku-4-5"],
  openai: ["gpt-4o", "gpt-4o-mini"],
};

interface OllamaTagsResponse {
  models?: Array<{ name?: string }>;
}

async function getOllamaInfo(baseUrl: string): Promise<ProviderInfo> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(OLLAMA_TAGS_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = (await res.json()) as OllamaTagsResponse;
    const models = Array.isArray(body.models)
      ? body.models.map((m) => m.name).filter((n): n is string => Boolean(n))
      : [];
    return { id: "ollama", label: LABELS.ollama, privacy: "local", models, configured: true };
  } catch {
    return {
      id: "ollama",
      label: LABELS.ollama,
      privacy: "local",
      models: [],
      configured: true,
      note: "Ollama not running",
    };
  }
}

function getCloudInfo(id: "anthropic" | "openai", apiKey: string, configuredModel: string): ProviderInfo {
  const models = Array.from(new Set([configuredModel, ...CLOUD_SUGGESTIONS[id]].filter(Boolean)));
  return { id, label: LABELS[id], privacy: "cloud", models, configured: Boolean(apiKey) };
}

/**
 * Testable core of `GET /api/providers`: given the current settings, reports
 * what's usable right now for each provider. Never includes key material —
 * only whether a key is present (`configured`).
 */
export async function getProviderInfo(settings: SiftSettings): Promise<ProviderInfo[]> {
  const ollama = await getOllamaInfo(settings.ollamaBaseUrl);
  const anthropic = getCloudInfo("anthropic", settings.anthropicApiKey, settings.anthropicModel);
  const openai = getCloudInfo("openai", settings.openaiApiKey, settings.openaiModel);
  return [ollama, anthropic, openai];
}

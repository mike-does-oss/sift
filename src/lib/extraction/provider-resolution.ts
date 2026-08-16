import { getSettings } from "@/lib/settings";
import { isHosted } from "@/lib/profile";
import type { ProviderId } from "@/lib/api";

export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";

/**
 * Per-request override: which provider/model to run instead of the
 * configured default. `provider` selects both the engine and whose settings
 * key/base URL to use (e.g. picking "ollama" always uses the settings
 * ollamaBaseUrl, regardless of the configured default provider); `model`
 * overrides that provider's configured model. Omitting the override leaves
 * behavior identical to reading straight from settings.
 *
 * `apiKey` is INTERNAL: only trusted server-side callers set it (the jobs
 * worker pinning a job's frozen BYO/platform decision — §SaaS-1 T5). HTTP
 * routes never populate it from request input, and the hosted branch treats
 * an override WITHOUT it as untrusted: provider must be "anthropic" and its
 * `model` is ignored (the model tier is a billing decision, not the user's).
 */
export interface ExtractionOverride {
  provider: ProviderId;
  model?: string;
  apiKey?: string;
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
  // Hosted profile (§SaaS-1 T5): provider policy is Anthropic-only and the
  // model/key pair is a billing decision (per-plan tiering, BYO → opus) —
  // settings-table provider config never applies there.
  if (isHosted()) return resolveHostedProvider(override, userId);

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

/**
 * Hosted resolution (§SaaS-1 T5, donor: extracto-app semantics):
 *
 * - A trusted internal override (carries `apiKey` — only the jobs worker
 *   builds these) is honored verbatim: the worker pins each job's frozen
 *   `usedByoKey` decision (BYO → opus on the owner's key, else the owner's
 *   plan model on the platform key) at claim time.
 * - Any other override is untrusted request input: non-"anthropic" providers
 *   are refused outright and `model` is ignored — the model tier comes from
 *   the plan, and BYO always means `BYO_KEY_MODEL`.
 * - Default: load the user's row — a stored key on a BYO-eligible plan runs
 *   opus on that key (quota-exempt, stamped at enqueue); otherwise the plan's
 *   model on the platform `ANTHROPIC_API_KEY`.
 */
async function resolveHostedProvider(override?: ExtractionOverride, userId?: string): Promise<ProviderResolution> {
  if (override?.apiKey !== undefined && override.provider === "anthropic" && override.model) {
    return { ok: true, provider: "anthropic", model: override.model, apiKey: override.apiKey };
  }
  if (override && override.provider !== "anthropic") {
    return { ok: false, provider: override.provider, model: override.model ?? "", error: "Only the Claude engine is available on the hosted service." };
  }

  if (!userId) {
    throw new Error("provider resolution requires a userId on the hosted profile");
  }
  const { getDbUserById } = await import("@/lib/user");
  const { PLANS, BYO_KEY_MODEL } = await import("@/lib/plans");
  const user = await getDbUserById(userId);
  if (!user) {
    return { ok: false, provider: "anthropic", model: "", error: "User not found" };
  }
  const plan = PLANS[user.plan];
  if (user.encryptedAnthropicKey && plan.byoKey) {
    const { decryptSecret } = await import("@/lib/crypto");
    return { ok: true, provider: "anthropic", model: BYO_KEY_MODEL, apiKey: decryptSecret(user.encryptedAnthropicKey) };
  }
  const platformKey = process.env.ANTHROPIC_API_KEY;
  if (!platformKey) {
    return { ok: false, provider: "anthropic", model: plan.model, error: "Extraction service is not configured — missing platform API key." };
  }
  return { ok: true, provider: "anthropic", model: plan.model, apiKey: platformKey };
}
